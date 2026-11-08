"""
JSON API used by the single page dashboard (frontend/ -> theonionbox/web).

The static part of the dashboard ("overview") is assembled here. Live data (charts, logs, ...)
continues to be delivered by the session based ``data.html`` endpoint of the dashboard app.
"""

import logging
import socket
from typing import Any, Callable, Dict, List, Optional

log = logging.getLogger('theonionbox')


def _safe(fn: Callable[[], Any], default: Any = None) -> Any:
    try:
        return fn()
    except Exception as exc:  # pragma: no cover - defensive; Tor / Onionoo may refuse anything
        log.debug(f'api: {exc}')
        return default


def _jsonable(value: Any) -> Any:
    """Make arbitrary values (datetime, bytes, sets, ...) safe for the JSON encoder."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    if isinstance(value, bytes):
        return value.decode('utf-8', 'replace')
    return str(value)


def _version_key(version: str):
    """'0.4.9.11' -> (0, 4, 9, 11); pre-release suffixes (-alpha, -rc, -dev) sort before the release."""
    main, _, suffix = version.partition('-')
    nums = tuple(int(x) if x.isdigit() else 0 for x in main.split('.'))
    return nums + (0,) * (4 - len(nums)), 0 if suffix else 1


def latest_tor_versions(tor):
    """
    Ask Tor itself which versions the network recommends (from the consensus).
    The former update service (a v2 onion address) is gone, Tor dropped v2 onions in 0.4.6.
    Returns (latest_stable, latest_unstable) - either may be None.
    """
    recommended = _safe(lambda: tor.get_info('status/version/recommended'), '') or ''
    versions = [v.strip() for v in recommended.split(',') if v.strip()]
    stable = [v for v in versions if '-' not in v]
    stable_latest = max(stable, key=_version_key) if stable else None
    unstable_latest = max(versions, key=_version_key) if versions else None
    return stable_latest, unstable_latest


def tor_section(tor, box_version, accounting_stats=None) -> Dict[str, Any]:
    short = _safe(lambda: tor.version_short, '')
    latest_stable, latest_unstable = latest_tor_versions(tor)

    mode = 'Client'
    if _safe(lambda: tor.get_conf('BridgeRelay', None)) == '1':
        mode = 'Bridge'
    elif _safe(lambda: tor.get_conf('ORPort', None)):
        mode = 'Relay'

    fingerprint = _safe(lambda: tor.fingerprint)
    flags: List[str] = []
    if mode == 'Relay':
        flags = _safe(lambda: list(tor.flags or []), [])

    return {
        'version': _safe(lambda: str(tor.get_version())),
        'version_short': short,
        'version_status': _safe(lambda: tor.version_current, 'unknown'),
        'latest_stable': latest_stable,
        'latest_unstable': latest_unstable,
        'is_latest_stable': (str(short) == latest_stable) if latest_stable else None,
        'is_latest_unstable': (str(short) == latest_unstable) if latest_unstable else None,
        'pid': _safe(lambda: tor.get_pid()),
        'user': _safe(lambda: tor.user),
        'nickname': _safe(lambda: tor.nickname),
        'mode': mode,
        'fingerprint': fingerprint,
        'flags': flags,
        'is_localhost': _safe(lambda: bool(tor.is_localhost()), False),
        'hibernating': (getattr(accounting_stats, 'status', 'awake') != 'awake') if accounting_stats else False,
    }


def host_section(host) -> Optional[Dict[str, Any]]:
    import psutil

    return {
        'name': _safe(lambda: host.name),
        'os': _safe(lambda: f'{host.system} {host.release}'),
        'os_version': _safe(lambda: host.version),
        'system': _safe(lambda: f'{host.processor} {host.machine}'.strip()),
        'uptime': _safe(lambda: host.uptime),
        'cpu_count': _safe(lambda: psutil.cpu_count(), 1),
        'memory_mb': _safe(lambda: host.memoryMB),
        'temperature': bool(_safe(lambda: host.temperature, False)),
    }


def config_section(configs_used: Dict[str, Any]) -> List[Dict[str, Any]]:
    out = []
    for name in sorted(configs_used or {}):
        values = configs_used[name]
        if values is None:
            values = []
        elif not isinstance(values, (list, tuple)):
            values = [values]
        out.append({'name': name, 'values': [str(v) for v in values]})
    return out


def hidden_service_section(tor) -> List[Dict[str, Any]]:
    hs = _safe(lambda: tor.get_hidden_service_conf(None))
    if not hs:
        return []

    out = []
    for hs_dir, conf in hs.items():
        options = {}
        for key, value in (conf or {}).items():
            if key == 'HiddenServiceDir':
                continue
            options[key] = _jsonable(value)
        out.append({'dir': hs_dir, 'options': options})
    return out


def network_section(oo_details, geoip) -> Optional[Dict[str, Any]]:
    """Subset of the Onionoo 'details' document."""
    if oo_details is None:
        return None

    def d(key):
        return _jsonable(_safe(lambda: oo_details(key)))

    if not _safe(lambda: oo_details.is_relay() or oo_details.is_bridge(), False):
        return None

    or_addresses = d('or_addresses') or []

    location = {}
    if or_addresses and geoip is not None:
        ip = or_addresses[0]
        location = {
            'country': _jsonable(_safe(lambda: geoip.country(ip, d('country')))),
            'country_name': _jsonable(_safe(lambda: geoip.country_name(ip, d('country_name')))),
            'region': _jsonable(_safe(lambda: geoip.region_name(ip, d('region_name')))),
            'city': _jsonable(_safe(lambda: geoip.city_name(ip, d('city_name')))),
            'latitude': _jsonable(_safe(lambda: geoip.latitude(ip, d('latitude')))),
            'longitude': _jsonable(_safe(lambda: geoip.longitude(ip, d('longitude')))),
        }
    else:
        location = {k: d(k) for k in ('country', 'country_name', 'latitude', 'longitude')}

    return {
        'type': 'Bridge' if _safe(lambda: oo_details.is_bridge(), False) else 'Relay',
        'fingerprint': d('fingerprint'),
        'nickname': d('nickname'),
        'platform': d('platform'),
        'contact': d('contact'),
        'or_addresses': or_addresses,
        'exit_addresses': d('exit_addresses') or [],
        'dir_address': d('dir_address'),
        'first_seen': d('first_seen'),
        'last_seen': d('last_seen'),
        'last_restarted': d('last_restarted'),
        'last_changed': d('last_changed_address_or_port'),
        'running': d('running'),
        'hibernating': d('hibernating'),
        'flags': d('flags') or [],
        'as_number': d('as_number'),
        'as_name': d('as_name'),
        'host_name': d('host_name'),
        'location': location,
        'published': _jsonable(_safe(lambda: oo_details.published())),
    }


def build_overview(*, tor, box_version, box_stamp: str, host, configs_used, accounting_stats,
                   accounting_switch: bool, oo_details, geoip, sections: List[str], show_logout: bool,
                   token: str, intervals: Dict[str, int], transport: Dict[str, int]) -> Dict[str, Any]:

    if _safe(lambda: tor.is_localhost(), False) is True:
        at_location = socket.gethostname()
    else:
        at_location = _safe(lambda: tor.get_info('address'), 'Remote Location')

    tor_info = tor_section(tor, box_version, accounting_stats if accounting_switch else None)

    return {
        'token': token,
        'box': {'version': box_stamp},
        'header': {
            'title': _safe(lambda: tor.nickname) or (f'Tor client @ {at_location}' if at_location else 'The Onion Box'),
            'location': at_location,
            'tor_version': tor_info['version_short'],
            'fingerprint': tor_info['fingerprint'],
            'logout': bool(show_logout),
        },
        'sections': sections,
        'tor': tor_info,
        'host': host_section(host) if 'host' in sections else None,
        'accounting': {'enabled': bool(accounting_switch)},
        'config': config_section(configs_used),
        'hidden_services': hidden_service_section(tor) if 'hiddenservice' in sections else [],
        'network': network_section(oo_details, geoip) if 'network' in sections else None,
        'intervals': intervals,
        'transport': transport,
    }
