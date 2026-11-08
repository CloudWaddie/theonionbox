"""bridge info + relay health checks, built from what tor tells us over the control port"""

import os
import shlex
import time
from typing import Any, Dict, List, Optional

from .api import _safe, _version_key

OK, WARN, FAIL = 'ok', 'warn', 'fail'
_RANK = {OK: 0, WARN: 1, FAIL: 2}

# a restart this recent is worth a hint
LOW_UPTIME = 2 * 3600


def _conf_list(tor, key: str) -> List[str]:
    try:
        value = tor.get_conf(key, None, multiple=True)
    except TypeError:
        value = tor.get_conf(key, None)
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    return [str(v) for v in value if v]


def _check(cid: str, label: str, status: str, detail: str) -> Dict[str, str]:
    return {'id': cid, 'label': label, 'status': status, 'detail': detail}


def _mode(tor) -> str:
    if _safe(lambda: tor.get_conf('BridgeRelay', None)) == '1':
        return 'Bridge'
    if _safe(lambda: tor.get_conf('ORPort', None)):
        return 'Relay'
    return 'Client'


def _reachability(tor) -> Optional[Dict[str, str]]:
    # "OR=1 DIR=1"; empty while tor hasn't tested yet
    raw = _safe(lambda: tor.get_info('status/reachability-succeeded'))
    if raw is None:
        return None
    parts = dict(p.split('=', 1) for p in str(raw).split() if '=' in p)
    return parts


def health(tor, oo_details=None, accounting_stats=None, latest_stable: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """checks for a relay or bridge. clients have nothing to check -> None"""

    mode = _mode(tor)
    if mode == 'Client':
        return None

    checks: List[Dict[str, str]] = []

    # tor itself
    status = _safe(lambda: tor.version_current, 'unknown')
    if status in ('obsolete', 'old', 'unrecommended'):
        checks.append(_check('version', 'Tor version', FAIL, f'This version is {status}; update Tor.'))
    else:
        version = _safe(lambda: str(tor.version_short), '')
        if latest_stable and version and _version_key(version) < _version_key(latest_stable):
            checks.append(_check('version', 'Tor version', WARN, f'{version} is recommended, yet {latest_stable} is available.'))
        else:
            checks.append(_check('version', 'Tor version', OK, f'{version} is up to date.'))

    # can the network reach us?
    reach = _reachability(tor)
    if reach is None:
        checks.append(_check('reachability', 'Reachability', WARN, 'Tor has not finished testing its ports yet.'))
    elif reach.get('OR') == '1':
        checks.append(_check('reachability', 'Reachability', OK, 'The ORPort is reachable from the outside.'))
    else:
        checks.append(_check('reachability', 'Reachability', FAIL, 'The ORPort is not reachable from the outside; check firewall & port forwarding.'))

    # does the directory accept our descriptor?
    good = _safe(lambda: tor.get_info('status/good-server-descriptor'))
    if good is not None:
        if str(good).strip().startswith('1'):
            checks.append(_check('descriptor', 'Descriptor', OK, 'The server descriptor is published.'))
        else:
            checks.append(_check('descriptor', 'Descriptor', FAIL, f'No good server descriptor: {str(good).strip() or "unknown reason"}.'))

    # hibernation
    hibernating = bool(accounting_stats) and getattr(accounting_stats, 'status', 'awake') != 'awake'
    if hibernating:
        checks.append(_check('hibernation', 'Accounting', WARN, f'The node is {accounting_stats.status}: it reached its traffic limit.'))
    elif accounting_stats:
        checks.append(_check('hibernation', 'Accounting', OK, 'Awake.'))

    # how long has it been up?
    uptime = _safe(lambda: int(tor.get_info('uptime')))
    if uptime is not None:
        if uptime < LOW_UPTIME:
            checks.append(_check('uptime', 'Uptime', WARN, f'Tor was restarted {max(uptime // 60, 1)} minutes ago; flags such as Stable & Guard need time.'))
        else:
            checks.append(_check('uptime', 'Uptime', OK, f'{uptime // 86400} days {uptime % 86400 // 3600} hours.'))

    if mode == 'Relay':
        flags = _safe(lambda: list(tor.flags or []), [])
        flags = [] if flags[:1] == ['unknown'] else flags
        if not flags:
            checks.append(_check('flags', 'Consensus flags', WARN, 'The network has not assigned flags (yet).'))
        else:
            missing = [f for f in ('Running', 'Valid') if f not in flags]
            soft = [f for f in ('Fast', 'Stable') if f not in flags]
            if missing:
                checks.append(_check('flags', 'Consensus flags', FAIL, f'Missing: {", ".join(missing)}.'))
            elif soft:
                checks.append(_check('flags', 'Consensus flags', WARN, f'Not (yet) assigned: {", ".join(soft)}.'))
            else:
                checks.append(_check('flags', 'Consensus flags', OK, ', '.join(flags) + '.'))

    # does the network know us?
    if oo_details is not None and _safe(lambda: oo_details.has_data(), False):
        running = _safe(lambda: oo_details('running'))
        if running is False:
            checks.append(_check('onionoo', 'Seen by the network', FAIL, 'Onionoo lists this node as not running.'))
        elif running:
            checks.append(_check('onionoo', 'Seen by the network', OK, 'Onionoo lists this node as running.'))

    # contact info: set, and the same one the network publishes
    contact = (_safe(lambda: tor.get_conf('ContactInfo', None)) or '').strip()
    if mode == 'Relay' or contact:
        if not contact:
            checks.append(_check('contact', 'ContactInfo', WARN, 'Not set: nobody can reach you if there is a problem with this relay.'))
        else:
            published = _safe(lambda: oo_details('contact')) if oo_details is not None else None
            if published and published.strip() != contact:
                checks.append(_check('contact', 'ContactInfo', WARN, 'The published contact differs from torrc; it updates with the next descriptor.'))
            else:
                checks.append(_check('contact', 'ContactInfo', OK, 'Set.'))

    worst = max((c['status'] for c in checks), key=_RANK.get, default=OK)
    return {'status': worst, 'checks': checks}


def _parse_pairs(text: str) -> Dict[str, str]:
    # a=1,b=2 -> {'a': '1', 'b': '2'}
    out = {}
    for item in text.split(','):
        if '=' in item:
            key, _, value = item.partition('=')
            out[key.strip()] = value.strip()
    return out


def clients_seen(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    """status/clients-seen: TimeStarted="..." CountrySummary=us=16,de=8 IPVersions=v4=16,v6=8"""
    if not raw:
        return None

    started = None
    countries: Dict[str, str] = {}
    versions: Dict[str, str] = {}

    for token in shlex.split(raw):
        key, _, value = token.partition('=')
        if key == 'TimeStarted':
            started = value
        elif key == 'CountrySummary':
            countries.update(_parse_pairs(value))
        elif key == 'IPVersions':
            versions.update(_parse_pairs(value))

    def num(v):
        try:
            return int(v)
        except ValueError:
            return 0

    ranked = sorted(({'country': c.upper(), 'count': num(n)} for c, n in countries.items()),
                    key=lambda x: -x['count'])
    return {
        'since': started,
        'countries': ranked,
        'ip_versions': {k: num(v) for k, v in versions.items()},
        'total': sum(c['count'] for c in ranked),
    }


def _bridge_line(tor) -> Optional[str]:
    # tor's pt_state holds the line to hand out; only readable if we run next to tor
    if not _safe(lambda: tor.is_localhost(), False):
        return None
    data_dir = _safe(lambda: tor.get_conf('DataDirectory', None))
    if not data_dir:
        return None
    for name in ('obfs4_bridge_line.txt', 'bridge-line.txt'):
        path = os.path.join(data_dir, 'pt_state', name)
        try:
            with open(path, encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and line.lower().startswith(('bridge ', 'obfs', 'webtunnel', 'snowflake')):
                        return line
        except OSError:
            continue
    return None


def bridge(tor, oo_details=None) -> Optional[Dict[str, Any]]:
    """what a bridge operator wants to know. None for relays & clients"""

    if _mode(tor) != 'Bridge':
        return None

    transports = []
    plugins = _conf_list(tor, 'ServerTransportPlugin')
    listen = {}
    for item in _conf_list(tor, 'ServerTransportListenAddr'):
        name, _, addr = item.partition(' ')
        listen[name] = addr.strip()

    for item in plugins:
        # "obfs4 exec /usr/bin/obfs4proxy"
        names, _, rest = item.partition(' ')
        for name in names.split(','):
            transports.append({'name': name, 'listen': listen.get(name), 'plugin': rest.strip() or None})
    for name, addr in listen.items():
        if not any(t['name'] == name for t in transports):
            transports.append({'name': name, 'listen': addr, 'plugin': None})

    published = _safe(lambda: oo_details('transports')) if oo_details is not None else None
    reach = _reachability(tor)
    distribution = _safe(lambda: tor.get_conf('BridgeDistribution', None))

    return {
        'or_port': _safe(lambda: tor.get_conf('ORPort', None)),
        'ext_or_port': _safe(lambda: tor.get_conf('ExtORPort', None)),
        'transports': transports,
        'published_transports': list(published) if isinstance(published, (list, tuple)) else [],
        'distribution': distribution,
        'publish': _safe(lambda: tor.get_conf('PublishServerDescriptor', None)),
        'hashed_fingerprint': _safe(lambda: oo_details('hashed_fingerprint')) if oo_details is not None else None,
        'reachable': None if reach is None else reach.get('OR') == '1',
        'bridge_line': _bridge_line(tor),
        'clients': clients_seen(_safe(lambda: tor.get_info('status/clients-seen'))),
        'time': int(time.time()),
    }
