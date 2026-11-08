"""controlcenter: json api (/<session>/api/cc/...) for monitoring many nodes. nodes + their credentials live in cc.cfg, the box connects on its own"""

import contextlib
import json
import logging
import os
import re
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional

import bottle

from ..apps import BaseApp
from ..ccfile import CCFile, CCNode
from ..nodes import Manager as NodesManager, Node
from ..plugin.session import SessionPlugin
from ..proxy import Proxy as TorProxy
from ..session import SessionManager
from ..utils import AttributedDict
from ..version import VersionManager

DEFAULT_ID = 'default'
COOKIE_RE = re.compile(r'^[a-zA-Z0-9+/]{22}$')   # see Tor(1), HidServAuth
CONTROL_COOKIE_RE = re.compile(r'^[0-9a-fA-F]{64}$')   # the 32 bytes of Tor's control_auth_cookie, as hex
CONNECTION_TYPES = ('port', 'socket', 'proxy')


class ValidationError(ValueError):
    pass


@contextlib.contextmanager
def _cookie_file(hex_cookie: str):
    # stem only takes a cookie file, so write a short lived one (mkstemp is 0600)
    fd, path = tempfile.mkstemp(prefix='tob-cookie-')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(bytes.fromhex(hex_cookie))
        yield path
    finally:
        with contextlib.suppress(OSError):
            os.unlink(path)


def _clean(value: Any, name: str, maxlen: int = 256, required: bool = False) -> Optional[str]:
    # these land in a config file, so no newlines etc
    if value is None:
        if required:
            raise ValidationError(f"'{name}' is required.")
        return None
    if not isinstance(value, str):
        raise ValidationError(f"'{name}' must be a string.")
    value = value.strip()
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValidationError(f"'{name}' contains invalid characters.")
    if len(value) > maxlen:
        raise ValidationError(f"'{name}' is too long.")
    if required and not value:
        raise ValidationError(f"'{name}' is required.")
    return value


def validate_node(data: Dict[str, Any], partial: bool = False) -> Dict[str, Any]:
    # partial = edit, keys that weren't sent stay out

    out: Dict[str, Any] = {}

    if 'label' in data or not partial:
        out['label'] = _clean(data.get('label'), 'label', 64) or None

    if 'control' in data or not partial:
        control = _clean(data.get('control'), 'control', 16, required=True)
        if control not in CONNECTION_TYPES:
            raise ValidationError(f"'control' must be one of {', '.join(CONNECTION_TYPES)}.")
        out['control'] = control

    if 'host' in data or not partial:
        out['host'] = _clean(data.get('host'), 'host', 255, required=True)

    if 'port' in data or not partial:
        port = data.get('port')
        if port in (None, ''):
            out['port'] = None
        else:
            try:
                port = int(port)
            except (TypeError, ValueError):
                raise ValidationError("'port' must be a number.")
            if not 1 <= port <= 65535:
                raise ValidationError("'port' must be between 1 and 65535.")
            out['port'] = str(port)

    for secret in ('password', 'cookie', 'control_cookie'):
        if secret in data:
            value = _clean(data.get(secret), secret, 256)
            if secret == 'cookie' and value and not COOKIE_RE.match(value):
                raise ValidationError("'cookie' is not a Tor authorization cookie (22 characters).")
            if secret == 'control_cookie' and value:
                if not CONTROL_COOKIE_RE.match(value):
                    raise ValidationError("'control_cookie' must be the 32 bytes of Tor's control_auth_cookie "
                                          "as 64 hex characters.")
                value = value.lower()
            out[secret] = value or None      # '' clears the value

    control = out.get('control')
    if control in ('port', 'proxy') and 'port' in out and out['port'] is None:
        raise ValidationError(f"'port' is required for connection type '{control}'.")

    return out


class ControlCenter(BaseApp):

    def __init__(self
                 , sessions: SessionManager
                 , nodes: NodesManager
                 , proxy: TorProxy
                 , version: VersionManager
                 , config: AttributedDict):

        super(ControlCenter, self).__init__(sessions=sessions, nodes=nodes, proxy=proxy, version=version,
                                            config=config)

        self.cc = CCFile(self.config.cc)
        self.log = logging.getLogger('theonionbox')

        # connect in the background so a dead node can't block the rest
        self.pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix='cc-connect')
        self.connecting: Dict[str, Any] = {}      # api id -> Future
        self.errors: Dict[str, Dict[str, str]] = {}   # api id -> {'kind': 'auth' | 'offline', 'message': ...}

        frame = {'valid_status': ['frame'], 'no_session_redirect': self.redirect.path('/')}

        def route(path, method, callback, **extra):
            self.app.route(path, method=method, callback=callback, apply=SessionPlugin(sessions),
                           **{**frame, **extra})

        route('/<session>/cc.html', 'GET', self.get_cc, valid_status=['auto', 'prepared', 'frame'])
        route('/<session>/cc/logout', 'GET', self.get_cc_logout)
        route('/<session>/api/cc/nodes', 'GET', self.api_list)
        route('/<session>/api/cc/nodes', 'POST', self.api_add)
        route('/<session>/api/cc/nodes/<name>', 'PUT', self.api_edit)
        route('/<session>/api/cc/nodes/<name>', 'DELETE', self.api_remove)
        route('/<session>/api/cc/nodes/<name>/open', 'POST', self.api_open)
        route('/<session>/api/cc/order', 'POST', self.api_order)
        route('/<session>/api/cc/test', 'POST', self.api_test)

    def get_cc(self, session):

        if session is None or 'status' not in session:
            raise bottle.HTTPError(404)

        if session['status'] == 'prepared':
            if time.time() - session['prep_time'] > 2.0:
                session['status'] = 'toolate'
            else:
                session['status'] = 'ok'

        if session['status'] not in ['ok', 'auto', 'frame']:
            self.sessions.delete_session(session)
            self.redirect('/')

        if 'show_logout' not in session or session['show_logout'] is None:
            session['show_logout'] = session['status'] == 'ok'

        # this session is the cc frame from now on
        session['status'] = 'frame'
        return self.serve_spa(session)

    def get_cc_logout(self, session):
        self.sessions.delete_session(session)
        self.redirect('/')

    def _sections(self) -> Dict[str, CCNode]:
        return {s.name: s for s in self.cc}

    def _config_of(self, api_id: str):
        if api_id == DEFAULT_ID:
            return self.nodes['theonionbox'].config
        return self._sections().get(api_id)

    def _node(self, api_id: str, create: bool = True) -> Optional[Node]:
        if api_id == DEFAULT_ID:
            return self.nodes['theonionbox']

        node = self.nodes.get_name(api_id)
        if node is None and create:
            section = self._sections().get(api_id)
            if section is not None:
                node = self.nodes.get(self.nodes.node_add(section))
        return node

    def _password(self, api_id: str) -> Optional[str]:
        config = self._config_of(api_id)
        return getattr(config, 'password', None) if config is not None else None

    def _connect(self, api_id: str, node: Node) -> None:
        # runs in the pool
        from stem.connection import AuthenticationFailure

        try:
            node.connect(proxy=self.proxy)
            tor = node.controller
            if not tor.is_alive():
                tor.reconnect()
            if not tor.is_authenticated():
                pi = None
                with contextlib.suppress(Exception):
                    pi = tor.get_protocolinfo()

                control_cookie = getattr(self._config_of(api_id), 'control_cookie', None)
                if control_cookie and pi is not None:
                    # remote node, can't read its cookie file: use the pasted cookie (safecookie, never sent as is)
                    with _cookie_file(control_cookie) as path:
                        pi.cookie_path = path
                        tor.authenticate(password=self._password(api_id), protocolinfo_response=pi)
                else:
                    # otherwise stem reads the file tor names in protocolinfo (shared volume)
                    tor.authenticate(password=self._password(api_id), protocolinfo_response=pi)
            self.errors.pop(api_id, None)
        except AuthenticationFailure as exc:
            message = str(exc) or 'Authentication failed.'
            # stem reports a dropped connection as an auth failure too
            kind = 'offline' if message.startswith('socket connection failed') else 'auth'
            self.errors[api_id] = {'kind': kind, 'message': message}
            with contextlib.suppress(Exception):
                node.disconnect()
        except Exception as exc:
            self.errors[api_id] = {'kind': 'offline', 'message': str(exc) or exc.__class__.__name__}
            with contextlib.suppress(Exception):
                node.disconnect()

    def _ready(self, api_id: str, node: Node) -> bool:
        # True if connected + authenticated, else kick off a (re)connect
        with contextlib.suppress(Exception):
            tor = node.controller
            if tor.is_alive() and tor.is_authenticated():
                return True

        future = self.connecting.get(api_id)
        if future is None or future.done():
            self.connecting[api_id] = self.pool.submit(self._connect, api_id, node)
        return False

    def _card(self, api_id: str, since: Optional[float]) -> Dict[str, Any]:
        config = self._config_of(api_id)
        node = self._node(api_id)
        is_default = api_id == DEFAULT_ID

        card: Dict[str, Any] = {
            'id': api_id,
            'is_default': is_default,
            'label': getattr(config, 'label', None),
            'control': getattr(config, 'control', None),
            'host': getattr(config, 'host', None),
            'port': getattr(config, 'port', None),
            'has_password': bool(getattr(config, 'password', None)),
            'has_cookie': bool(getattr(config, 'cookie', None)),
            'has_control_cookie': bool(getattr(config, 'control_cookie', None)),
            'editable': not is_default and not self.cc.readonly,
            'state': 'connecting',
        }

        if node is None:
            card['state'] = 'offline'
            return card

        if not self._ready(api_id, node):
            err = self.errors.get(api_id)
            if err:
                card['state'] = err['kind']
                card['error'] = err['message']
            return card

        try:
            tor = node.controller
            mode = 'Client'
            if tor.get_conf('BridgeRelay', None) == '1':
                mode = 'Bridge'
            elif tor.get_conf('ORPort', None):
                mode = 'Relay'

            flags = []
            if mode == 'Bridge':
                with contextlib.suppress(Exception):
                    flags = list(node.onionoo.details('flags') or [])
            else:
                f = tor.flags
                if f and f[0] != 'unknown':
                    flags = list(f)

            hibernating = None
            with contextlib.suppress(Exception):
                accs = tor.get_accounting_stats()
                if accs.status != 'awake':
                    hibernating = accs.status

            samples = node.bandwidth.get_data(interval='1s', since_timestamp=since)
            fingerprint = None
            with contextlib.suppress(Exception):
                fingerprint = tor.fingerprint or None

            card.update({
                'state': 'ok',
                'nickname': node.nickname,
                'version': tor.version_short,
                'version_status': tor.version_current,
                'mode': mode,
                'flags': flags,
                'hibernating': hibernating,
                'fingerprint': fingerprint,
                'circuits': node.circuits.count,
                'connections': node.connections.count,
                'streams': node.streams.count,
                'bw': list(samples or []),
            })
        except Exception as exc:
            self.log.debug(f'ControlCenter: {api_id}: {exc}')
            card['state'] = 'offline'
            card['error'] = str(exc)

        return card

    def _json_body(self) -> Dict[str, Any]:
        try:
            data = bottle.request.json
        except Exception:
            data = None
        if not isinstance(data, dict):
            self._fail(400, 'A JSON object is expected.')
        return data

    @staticmethod
    def _ok(payload: Dict[str, Any]) -> str:
        bottle.response.content_type = 'application/json'
        bottle.response.set_header('Cache-Control', 'no-store')
        return json.dumps(payload)

    @staticmethod
    def _fail(status: int, message: str):
        raise bottle.HTTPResponse(body=json.dumps({'error': message}), status=status,
                                  content_type='application/json')

    def api_list(self, session):

        try:
            since = float(bottle.request.query.get('since')) if bottle.request.query.get('since') else None
        except ValueError:
            since = None

        ids = [s.name for s in self.cc]
        cards = [self._card(i, since) for i in ids]

        # skip the local default node unless it exists, in a container it never does
        default = self._card(DEFAULT_ID, since)
        if default['state'] in ('ok', 'auth'):
            cards.insert(0, default)

        return self._ok({'tick': int(time.time() * 1000), 'readonly': self.cc.readonly, 'nodes': cards})

    def api_add(self, session):
        try:
            fields = validate_node(self._json_body())
        except ValidationError as exc:
            self._fail(400, str(exc))

        config = self.cc.add_node()      # None if the file is read-only
        if config is None:
            self._fail(403, 'The ControlCenter configuration file is read-only.')

        for key, value in fields.items():
            setattr(config, key, value)
        config.tick()
        return self._ok({'id': config.name})

    def api_edit(self, session, name):
        section = self._sections().get(name)
        if section is None:
            self._fail(404, 'Unknown node.')
        if self.cc.readonly:
            self._fail(403, 'The ControlCenter configuration file is read-only.')

        data = self._json_body()
        merged = {'control': section.control, 'host': section.host, 'port': section.port}
        merged.update(data)
        try:
            fields = validate_node(data, partial=True)
            validate_node({**merged, **{k: v for k, v in fields.items() if v is not None}}, partial=True)
        except ValidationError as exc:
            self._fail(400, str(exc))

        for key, value in fields.items():
            setattr(section, key, value)
        section.tick()

        # reconnect with the new settings
        node = self.nodes.get_name(name)
        if node is not None:
            node.disconnect()
        self.errors.pop(name, None)
        return self._ok({'id': name})

    def api_remove(self, session, name):
        section = self._sections().get(name)
        if section is None:
            self._fail(404, 'Unknown node.')
        if self.cc.readonly:
            self._fail(403, 'The ControlCenter configuration file is read-only.')

        node = self.nodes.get_name(name)
        if node is not None:
            for s in list(self.sessions):
                with contextlib.suppress(Exception):
                    if s['node'] == node.id:
                        self.sessions.delete_session(s)
            self.nodes.node_remove(node.id)

        if section.remove() is not True:
            self._fail(500, 'Could not update the configuration file.')
        section.tick()
        self.errors.pop(name, None)
        return self._ok({'id': name})

    def api_order(self, session):
        data = self._json_body()
        order = data.get('order')
        if not isinstance(order, list) or not all(isinstance(i, str) for i in order):
            self._fail(400, "'order' must be a list of node ids.")
        if self.cc.readonly:
            self._fail(403, 'The ControlCenter configuration file is read-only.')

        sections = self._sections()
        previous = None
        for name in order:
            current = sections.get(name)
            if current is None:
                continue
            current.move_after(previous)
            previous = current
        return self._ok({'ok': True})

    def api_test(self, session):
        # does a control port answer? password is deliberately not tried
        from ..simplecontroller import SimplePort, SimpleSocket, SimpleProxy

        try:
            data = self._json_body()
            fields = validate_node({**data, 'label': None}, partial=False)
        except ValidationError as exc:
            self._fail(400, str(exc))

        control, host, port = fields['control'], fields['host'], fields.get('port')
        sc = None
        try:
            if control == 'port':
                sc = SimplePort(host, int(port))
            elif control == 'socket':
                sc = SimpleSocket(host)
            else:
                cookie = fields.get('cookie')
                if cookie:
                    self.proxy.assure_cookie(host, cookie)
                sc = SimpleProxy(host, int(port), self.proxy.host, self.proxy.port)

            info = sc.msg('PROTOCOLINFO 1').splitlines()
            ok = len(info) == 4 and info[0].startswith('250-PROTOCOLINFO') and info[3] == '250 OK'
            auth = next((line for line in info if line.startswith('250-AUTH')), '')
            methods = re.search(r'METHODS=([A-Z,]+)', auth)
            return self._ok({
                'ok': ok,
                'message': 'Tor ControlPort found.' if ok else 'Not a Tor ControlPort or ControlSocket.',
                'methods': methods.group(1).split(',') if methods else [],
            })
        except Exception as exc:
            return self._ok({'ok': False, 'message': str(exc) or exc.__class__.__name__, 'methods': []})
        finally:
            if sc is not None:
                with contextlib.suppress(Exception):
                    sc.shutdown()

    def api_open(self, session, name):
        # details = new 'login' session that the dashboard restart route picks up
        node = self._node(name)
        if node is None:
            self._fail(404, 'Unknown node.')

        # connect first with the stored creds so the dashboard doesn't ask for a password
        if not self._ready(name, node):
            future = self.connecting.get(name)
            if future is not None:
                with contextlib.suppress(Exception):
                    future.result(timeout=35)
            if not self._ready(name, node):
                err = self.errors.get(name, {})
                self._fail(409, err.get('message') or 'The node is not reachable.')

        details = self.sessions.create_session(bottle.request, 'login')
        if details is None:
            self._fail(500, 'Could not create a session.')
        details['password'] = self._password(name)
        details['cached_node'] = node.id
        return self._ok({'path': f'{self.base_path}/{details.id}/'})

    @property
    def base_path(self) -> str:
        return self.config.box.base_path
