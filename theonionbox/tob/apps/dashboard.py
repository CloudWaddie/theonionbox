import contextlib
import json
import pathlib
from threading import Timer
from typing import Optional
import uuid

from bottle import Bottle, HTTPError, request, response

from ..apps import BaseApp
from ..geoip import GeoIPOO
from ..nodes import Manager as NodesManager, Node
from ..onionoo import getOnionoo
from ..plugin import SessionPlugin
from ..proxy import Proxy
from ..session import SessionManager, Session, make_short_id
from ..system import BaseSystem
from ..utils import AttributedDict
from ..version import VersionManager
# from tob.scheduler import Scheduler

class Dashboard(BaseApp):

    def __init__(self
                 , sessions: SessionManager
                 , nodes: NodesManager
                 , proxy: Proxy
                 , version: VersionManager
                 , config: AttributedDict
                 , system: BaseSystem
                 , geoip: GeoIPOO):

        super().__init__(sessions=sessions, nodes=nodes, proxy=proxy, version=version,
                         config=config)

        self.system = system
        self.cwd = pathlib.Path(self.config['cwd'])

        # #####
        # # GeoIP2 interface
        self.geoip2 = geoip

        # Will be overwritten if we operate a ControlCenter
        self.default_page = "index.html"

        #####
        # The routing table

        config = {
            'no_session_redirect': self.redirect.path('/')
        }

        self.app.route('/',
                       method='GET',
                       callback=self.get_start,
                       **config)

        self.app.route('/<session_id>/',
                       method='GET',
                       callback=self.get_restart,
                       **config)

        self.app.route('/<session_id>/failed.html',
                       method='GET',
                       callback=self.get_failed,
                       **config)

        config['valid_status'] = ['ok', 'auto']

        self.app.route('/<login_id>/login.html',
                       method='GET',
                       callback=self.perform_login,
                       **config)

        self.app.route('/<session_id>/logout.html',
                       method='GET',
                       callback=self.get_logout,
                       **config)

        config['valid_status'] = ['ok', 'auto', 'prepared']

        self.app.route('/<session>/index.html',
                       method='GET',
                       callback=self.get_index,
                       **config)

        # What the web interface needs, whatever page it is currently showing:
        config['valid_status'] = ['ok', 'auto', 'prepared', 'login', 'error', 'frame']

        self.app.route('/<session>/assets/<filename:path>',
                       method='GET',
                       callback=self.get_asset,
                       **config)

        self.app.route('/<session>/api/state',
                       method='GET',
                       callback=self.get_state,
                       **config)

        config = {
            'valid_status': ['ok', 'auto']
        }

        self.app.route('/<session>/api/overview',
                       method='GET',
                       callback=self.get_overview,
                       **config)

        self.app.route('/<session>/api/health',
                       method='GET',
                       callback=self.get_health,
                       **config)

        self.app.route('/<session>/data.html',
                       method='POST',
                       callback=self.post_data,
                       **config)

        # Plugin for session management
        self.app.install(SessionPlugin(self.sessions))

    # Default Landing Page
    def get_start(self):

        session = self.sessions.create_session(request, 'login')

        if session is None:
            raise HTTPError(404)

        if self.default_page == 'cc.html':
            # ControlCenter mode: every node - the local one included - is just a card; it is connected (with the
            # credentials of the configuration file) in the background. Nothing has to work to show the page.
            session['status'] = 'auto'
            session['node'] = 'theonionbox'
            self.redirect(f'/{session.id}/cc.html')

        # This allows to login via a command line provided password (to address HashedControlPassword authmethod)
        pwd = self.nodes['theonionbox'].config.password
        if pwd is not None:
            session['password'] = pwd
            session['logout:show'] = False

        return self.connect_session_to_node(session, 'theonionbox', proceed_to_page=self.default_page)

    def connect_session_to_node(self, session: Session, node_id: str, proceed_to_page: Optional[str] = None):

        from stem.connection import MissingPassword, IncorrectPassword

        if proceed_to_page is None:
            proceed_to_page = self.default_page

        try:
            super().connect_session_to_node(session, node_id)
        except (MissingPassword, IncorrectPassword):
            return self.create_login_page(session, self.nodes[node_id], proceed_to_page)
        except HTTPError:
            raise
        except Exception as exc:
            return self.create_error_page(session, exc)

        session['status'] = 'auto'  # this indicates that there is no login necessary; therefore no logout possible!
        self.redirect(f'/{session.id}/{proceed_to_page}')

    def create_error_page(self, session: Session, display_error: BaseException):

        self.log.info(f'Session {make_short_id(session.id)}: Error Page @ "{display_error}"')

        # We failed to connect to Tor and have to admit this now!
        session['status'] = 'error'
        session['error'] = str(display_error) or display_error.__class__.__name__

        return self.serve_spa(session)

    def create_login_page(self, session: Session, node: Node, proceed_to_page: str):

        self.log.debug('Session {} o-A-o {} Node'.format(session.id, node.id))

        # Digest if the Box knows the password (and merely verifies the one provided); Basic if it has to forward it.
        session['auth'] = 'digest' if node.controller.password is not None else 'basic'
        session['proceed_to'] = proceed_to_page

        return self.serve_spa(session)

    def get_state(self, session):
        """Tells the web interface which page to show."""

        status = session['status']
        state = {'box': self.config.stamped_version, 'cc': self.default_page == 'cc.html'}

        if status == 'login':
            label = None
            with contextlib.suppress(Exception):
                label = self.nodes.get(session['node'] or session['cached_node']).label
            state.update(page='login', auth=session['auth'] or 'basic', proceed_to=session['proceed_to'] or 'index.html',
                         label=label)
        elif status == 'error':
            state.update(page='error', message=session['error'] or 'Unknown error.')
        elif status == 'frame':
            state.update(page='cc', logout=bool(session['show_logout']))
        else:
            state.update(page='dashboard')

        response.content_type = 'application/json'
        response.set_header('Cache-Control', 'no-store')
        return json.dumps(state)

    def get_restart(self, session_id):

        # When monitoring a controlled node, this is the default landing page
        # in case of login error or logout procedure

        # The CC uses this as well to launch the detail page delivery.

        session = self.sessions.get_session_without_validation(session_id)

        if session is None:
            self.redirect('/')

        status = session.get('status')
        if status != 'login':
            self.redirect('/')

        # session shall already be a newly created one, status 'login'
        # carrying in 'cached_node' the id of the node formerly connected to (or intending to log into)

        node_id = session.get('node')
        cached_id = session.get('cached_node')

        # 'node_id is not None' indicates that the session already went through a 'connect_session_...' cycle
        # This happens when the user reloads the page after a failed attempt to login
        # => Restart with a fresh session

        # session might be expired! In that case, we create a new session and restart

        if node_id is not None or session.expired:
            self.sessions.delete_session(session)
            new_session = self.sessions.create_session(request, 'login')
            new_session['cached_node'] = node_id
            self.redirect(f'/{new_session.id}/')

        if cached_id is None:
            self.sessions.delete_session(session)
            self.redirect('/')

        return self.connect_session_to_node(session, cached_id, proceed_to_page="index.html")

    #####
    #  The Authentication System

    def perform_login(self, login_id):

        from ..authenticate import authenticate

        self.log.debug(f'Login Request: {make_short_id(login_id)}@{request.remote_addr} / {request.remote_route}')

        # boxLog.debug("{}@{} requests '{}'".format(make_short_id(login_id), request.remote_addr, 'login.html'))
        # boxLog.debug(
        #     "{}: addr = {} / route = {}".format(make_short_id(login_id), request.remote_addr, request.remote_route))

        session = self.sessions.get_session(login_id, request)

        if session is None:
            self.redirect('/')

        # print(session['status'])

        if session['status'] != 'login':
            self.sessions.delete_session(session)
            self.redirect('/')

        node = None
        try:
            node = self.nodes.get(session['node'])
        except:
            self.sessions.delete_session(session)
            self.redirect('/')

        if 'login' in session:
            session['login'] += 1
            if session['login'] > 1 or (self.time() - session['login_time']) > 1.5:
                self.sessions.delete_session(session)
                raise HTTPError(404)
        else:
            session['login'] = 0
            session['login_time'] = self.time()

        header = request.environ.get('HTTP_AUTHORIZATION', '')

        # this raises HTTPError(401) to perform the authentication procedure
        pwd = authenticate(session, node, header)

        # at this stage we have a successful login
        # and switch to standard session management
        self.sessions.delete_session(session)

        authed_session = self.sessions.create_session(request, 'prepared')
        if authed_session is not None:
            authed_session['node'] = node.id
            authed_session['prep_time'] = self.time()
            authed_session['password'] = pwd

            return authed_session.id

        raise HTTPError(404)

    def get_failed(self, session_id):
        session = self.sessions.get_session_without_validation(session_id)

        if session is not None:
            node_id = session.get('node')
            self.log.notice(f'{session.id_short()}@{request.remote_addr}: Login failed.')
            self.sessions.delete_session(session)

            new_session = self.sessions.create_session(request, 'login')
            new_session['cached_node'] = node_id

            self.redirect('/' + new_session.id + '/?failed=1')

        self.log.warning(f"Unknown client @ 'failed.html': {make_short_id(session_id)}@{request.remote_addr}")
        self.redirect('/')

    # This is the standard page!
    def get_index(self, session):

        status = session['status']

        if status == 'prepared':

            delay = self.time() - session['prep_time']

            if delay > 2.0:  # seconds
                session['status'] = 'toolate'  # ;)
                self.log.warning(f'{session.id_short()}: Login to Session delay expired. Session canceled.')
            else:
                session['status'] = 'ok'
                # we have a successfull connection! Celebrate this!
                self.log.notice(f'{session.id_short()}: Session established.')

        if session['status'] not in ['ok', 'auto']:
            self.sessions.delete_session(session)
            self.redirect('/')

        try:
            node = self.nodes.get(session['node'])
        except Exception:
            self.sessions.delete_session(session)
            self.redirect('/')

        tor = node.controller
        fingerprint = tor.fingerprint

        if self.verify_fingerprint(fingerprint) is True:
            oo = getOnionoo()
            oo.trigger(fingerprint)

        # reset the time flags!
        del session['cpu']
        del session['accounting']
        del session['monitor']
        del session['network']
        del session['network_bw']
        del session['network_weights']
        del session['family']

        # setup the MessageHandler for this session
        # node.torLogMgr.add_client(session.id)

        # prepare the preserved events for hardcoded transfer
        from ..log import sanitize_for_html
        # p_ev = node.torLogMgr.get_events(session.id, encode=sanitize_for_html)
        p_ev = []

        accounting_stats = {}
        try:
            accounting_stats = tor.get_accounting_stats()
            accounting_switch = True
        except:
            accounting_switch = False

        #####
        # Page Construction
        #
        # '!' as first character creates a named div
        # '-' as entry adds a <hr>

        # !header
        #   header
        # !content
        #   host
        #   config
        #   hiddenservice
        #   local
        #   network
        #       network_bandwidth
        #       network_weights
        #       -
        #   accounting
        #   monitor
        #   family
        #   control
        #   messages
        #   license

        sections = ['!header', 'header',
                    '!content']

        # sections += ['controlcenter']

        if tor.is_localhost():
            sections += ['host']

        sections += ['config']

        hsc = tor.get_hidden_service_conf(None)
        if hsc is not None and len(hsc) > 0:
            sections += ['hiddenservice']

        sections += ['local']

        params = {}

        sections_oo = []
        # with contextlib.suppress(AttributeError):

        if node.onionoo is not None and node.onionoo.details.has_data():
            sections_oo += ['network']
            params['oo_details'] = node.onionoo.details

            if node.onionoo.bandwidth.has_data():
                sections_oo += ['network_bandwidth']
                params['oo_bw'] = node.onionoo.bandwidth

            if node.onionoo.weights.has_data():
                sections_oo += ['network_weights']
                params['oo_weights'] = node.onionoo.weights

        if len(sections_oo) > 0:
            sections_oo += ['-']  # <hr>

        sections += sections_oo

        if accounting_switch is True:
            sections += ['accounting']

        sections += ['monitor']

        sections += ['transport']

        # this is for testing purposes only
        # sections += ['nodes', 'transport']

        # if fingerprint:
        #     sections.append('family')

        sections += ['messages']

        sections += ['license']

        session['sections'] = sections

        # The dashboard is a single page app (see frontend/ -> web/); it only needs the files below.
        session['stylesheets'] = []
        session['scripts'] = []

        if session['logout:show'] is not None:
            # 20200102: Currently only used if password for default node provided via command line.
            show_logout = session['logout:show']
        else:
            show_logout = session['status'] != 'auto' or session['password'] is not None

        def get_lines(info):
            return len([line for line in (info or '').split('\n') if line.strip()])

        transport = {
            'or': get_lines(tor.get_info('orconn-status')),
            'stream': get_lines(tor.get_info('stream-status')),
            'circ': get_lines(tor.get_info('circuit-status')),
        }

        # This is the initial session token
        session['token'] = uuid.uuid4().hex

        # Preparation for the Configuration display
        from ..configcollector import ConfigCollector
        configs_used = ConfigCollector(tor).collect_configs_used()

        from ..livedata import intervals
        from .. import api

        session['overview'] = overview = api.build_overview(
            tor=tor,
            box_version=self.version,
            box_stamp=self.config.stamped_version,
            host=self.system,
            configs_used=configs_used,
            accounting_stats=accounting_stats,
            accounting_switch=accounting_switch,
            oo_details=params.get('oo_details'),
            geoip=self.geoip2,
            sections=sections,
            show_logout=show_logout,
            token=session['token'],
            intervals=intervals,
            transport=transport,
        )

        overview['cc'] = self.default_page == 'cc.html'     # => offer the way back to all nodes

        # re-ping the session - to prevent accidential timeout
        self.sessions.get_session(session.id, request)

        return self.serve_spa(session)

    def get_overview(self, session):
        overview = session['overview']
        if overview is None:
            raise HTTPError(404)
        # hand out the *current* token; it rotates with each call of data.html
        overview['token'] = session['token']
        response.content_type = 'application/json'
        response.set_header('Cache-Control', 'no-store')
        return json.dumps(overview)

    def get_health(self, session):
        # bridge info & health checks; the page polls this once a minute
        try:
            node = self.nodes[session['node']]
            tor = node.controller
        except Exception:
            raise HTTPError(404)

        from .. import api, health

        oo_details = None
        if node.onionoo is not None:
            oo_details = node.onionoo.details

        accounting = None
        try:
            accounting = tor.get_accounting_stats()
        except Exception:
            pass

        latest_stable, _ = api.latest_tor_versions(tor)

        response.content_type = 'application/json'
        response.set_header('Cache-Control', 'no-store')
        return json.dumps({
            'health': health.health(tor, oo_details, accounting, latest_stable),
            'bridge': health.bridge(tor, oo_details),
        })

    def post_data(self, session):

        session_id = session.id

        node = None
        tor = None

        # Session token verification
        token = request.forms.get('token', None)
        if token is None or token != session['token']:
            self.sessions.delete_session(session)
            self.log.warning("Token mismatch at session {}. Session closed.".format(session.id_short()))
            raise HTTPError(404)

        if session['status'] in ['ok', 'auto']:
            try:
                node = self.nodes[session['node']]
                tor = node.controller
            except:
                raise HTTPError(404)
            fp = tor.fingerprint
        elif session['status'] in ['search']:
            fp = session['search']
        else:
            raise HTTPError(503)

        # create new session token
        session['token'] = uuid.uuid4().hex

        its_now = int(self.time()) * 1000  # JS!

        return_data_dict = {'tick': its_now}

        box_sections = session['sections']

        # host
        if 'host' in box_sections:

            since = session['cpu'] if 'cpu' in session else None
            cpu_list = self.system.get_performance_data(after=since)

            # this little hack ensures, that we deliver data on the
            # first *two* calls after launch!
            session['cpu'] = its_now if 'cpu' in session else 0

            if len(cpu_list) > 0:
                return_data_dict['gen'] = cpu_list

        # accounting
        if 'accounting' in box_sections:

            from stem import ControllerError

            accs = None

            try:
                accs = tor.get_accounting_stats()
                ret = accs.retrieved

                # to compensate for 'Object of type datetime is not JSON serializable' error
                accs = accs._replace(interval_end=accs.interval_end.timestamp())
                # our JS script needs the field names...
                accs = accs._asdict()

            except ControllerError:
                ret = its_now

            acc = {'enabled': accs is not None}

            if accs is not None:
                acc['stats'] = accs

            session['accounting'] = ret     # currently not used!
            return_data_dict['acc'] = acc

        # messages
        if 'messages' in box_sections:
            runlevel = request.forms.get('runlevel', None)

            if runlevel:

                rl_dict = json.JSONDecoder().decode(runlevel)

                # boxLog.debug('Levels from the client @ {}: {}'.format(session_id, rl_dict))

                for key in rl_dict:
                    changed = node.logs.switch(session_id, key, rl_dict[key])

                    # auto cancel 'DEBUG' mode after 30 seconds
                    if key == 'DEBUG' and rl_dict[key] and changed:
                        Timer(30,
                              node.logs.switch,
                              kwargs={'session_id': session_id,
                                      'level': key,
                                      'status': False}).start()

            from ..log import sanitize_for_html
            log_list = node.logs.get_events(session_id, encode=sanitize_for_html)

            if log_list and len(log_list) > 0:
                return_data_dict['msg'] = log_list

            log_status = node.logs.get_status(session_id)
            if log_status is not None:
                return_data_dict['msg_status'] = log_status

        # get the onionoo data
        # onionoo_details = onionoo.details(fp)
        # onionoo_bw = onionoo.bandwidth(fp)
        # onionoo_weights = onionoo.weights(fp)

        # operations monitoring
        if 'monitor' in box_sections:

            from ..livedata import intervals

            return_data_dict['mon'] = {}
            last_ts = None
            if 'monitor' in session:
                last_ts = session['monitor']
                if last_ts == 0:
                    last_ts = None

            for interval in intervals:
                try:
                    retval = node.bandwidth.get_data(interval=interval, since_timestamp=last_ts)
                    if len(retval) > 0:
                        return_data_dict['mon'][interval] = retval
                except Exception as e:
                    pass

            # if ('network_bw' not in session) or (session['network_bw'] == 0):
            #     res = {}
            #     obwr = node.onionoo.bandwidth.read()
            #     obww = node.onionoo.bandwidth.write()
            #     # obwr = None
            #     # obww = None
            #     if obwr is not None:
            #         res['read'] = obwr
            #     if obww is not None:
            #         res['write'] = obww
            #     if len(res) > 0:
            #         return_data_dict['mon']['oo_bw'] = res

            # this little hack ensures, that we deliver data on the
            # first *two* calls after launch!
            session['monitor'] = its_now if 'monitor' in session else 0

        # operations monitoring
        # if 'controlcenter' in box_sections:
        #
        #     return_data_dict['cc'] = {}
        #     last_ts = None
        #     if 'controlcenter' in session:
        #         last_ts = session['controlcenter']
        #         if last_ts == 0:
        #             last_ts = None
        #
        #     # try:
        #     #     retval = node.livedata.get_data(since_timestamp=last_ts)
        #     #     if len(retval) > 0:
        #     #         return_data_dict['cc']['1s'] = retval
        #     # except Exception as e:
        #     #     print(e)
        #     #     pass
        #
        #     retval = node.livedata.get_data(since_timestamp=last_ts)
        #     if len(retval) > 0:
        #         return_data_dict['cc']['1s'] = retval
        #
        #     # this little hack ensures, that we deliver data on the
        #     # first *two* calls after launch!
        #     session['controlcenter'] = its_now if 'cc' in session else 0

        if 'network' in box_sections:
            # Once there was code here.
            # It's no more ;) !
            pass

        if 'network_bandwidth' in box_sections:
            if ('network_bw' not in session) or (session['network_bw'] == 0):
                return_data_dict['oo_bw'] = {'read': node.onionoo.bandwidth.read(),
                                             'write': node.onionoo.bandwidth.write()}
                # this little hack ensures, that we deliver data on the
                # first *two* calls after launch!
                session['network_bw'] = node.onionoo.bandwidth.published() if 'network_bw' in session else 0
            elif session['network_bw'] != node.onionoo.bandwidth.published():
                del session['network_bw']
                # if there's new data act as if we've not had any before!
                # we'll therefore deliver the new data with the next run!

        if 'network_weights' in box_sections:
            if ('network_weights' not in session) or (session['network_weights'] == 0):

                details = {'cw': node.onionoo.details('consensus_weight'),
                           'cwf': node.onionoo.details('consensus_weight_fraction'),
                           'gp': node.onionoo.details('guard_probability'),
                           'mp': node.onionoo.details('middle_probability'),
                           'ep': node.onionoo.details('exit_probability')}

                return_data_dict['oo_weights'] = {'cw': node.onionoo.weights.consensus_weight(),
                                                  'cwf': node.onionoo.weights.consensus_weight_fraction(),
                                                  'ep': node.onionoo.weights.exit_probability(),
                                                  'gp': node.onionoo.weights.guard_probability(),
                                                  'mp': node.onionoo.weights.middle_probability(),
                                                  'data': details
                                                  }

                # print(return_data_dict['oo_weights'])

                # this little hack ensures, that we deliver data on the
                # first *two* calls after launch!
                session['network_weights'] = node.onionoo.weights.published() if 'network_weights' in session else 0
            elif session['network_weights'] != node.onionoo.weights.published():
                del session['network_weights']
                # if there's new data act as if we've not had any before!
                # we'll therefore deliver the new data with the next run!

        if 'family_xx' in box_sections:

            # get the family entries from the onionoo details of the node
            fp = tor.fingerprint
            family_details = onionoo.details(fp)

            if family_details is not None:

                # there are several different categories of families
                fams = ['effective_family', 'alleged_family', 'indirect_family']

                family_data = {}  # the read / write data for one node; key = fingerprint of node (pre 5.0: [1:])
                family_nodes = []  # list of fingerprints of the nodes (pre 5.0: [1:])

                if 'family' not in session:
                    session['family'] = {}

                session_family = session['family']

                # iterate through the categories
                for fam in fams:

                    # get the nodes per category
                    fam_det = family_details(fam)
                    if fam_det is not None:
                        # iterate through the nodes
                        for fp in fam_det:
                            # onionoo protocol v5.0 adaptation
                            node_fp = fp[1:] if fp[0] == '$' else fp
                            node_key = 'family:{}'.format(node_fp)
                            node_bw = onionoo.bandwidth(node_fp)

                            if node_bw is not None:
                                if (node_key not in session_family) or (session_family[node_key] == 0):
                                    family_nodes.append(node_fp)
                                    family_data[node_fp] = {'read': node_bw.read(), 'write': node_bw.write()}

                                    # this little hack ensures, that we deliver data on the
                                    # first *two* calls after launch!
                                    session_family[node_key] = node_bw.published() if node_key in session_family else 0

                                elif session_family[node_key] != node_bw.published():
                                    del session_family[node_key]
                                    # if there's new data act as if we've not had any before!
                                    # we'll therefore deliver the new data with the next run!

                # if we found some family entries
                if len(family_nodes) > 0:
                    # prepare the data
                    family_data['keys'] = family_nodes
                    return_data_dict['oo_family'] = family_data

        if 'transport' in box_sections:

            return_data_dict['transport'] = { 'or': node.connections.count,
                                              'circ': node.circuits.count,
                                              'stream': node.streams.count}

        #provide new session token
        return_data_dict['token'] = session['token']

        # Now json everything... and return it!
        return json.JSONEncoder().encode(return_data_dict)

    def get_logout(self, session_id):
        session = self.sessions.get_session_without_validation(session_id)

        if session is not None:
            node_id = session.get('node')
            self.log.notice(f'{session.id_short()}@{request.remote_addr}: Active LogOut!')
            self.sessions.delete_session(session)

            new_session = self.sessions.create_session(request, 'login')
            new_session['cached_node'] = node_id

            self.redirect(f'/{new_session.id}/')

        self.log.warning(f'LogOut requested from unknown client: {make_short_id(session_id)}@{request.remote_addr}')
        self.redirect('/')
