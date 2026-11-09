"""Snowflake proxy monitoring: reads the Prometheus endpoint of a standalone Snowflake proxy.

A Snowflake proxy has no control port. Started with `-metrics`, it serves counters at
http://<metrics-address>:<metrics-port>/internal/metrics (default localhost:9999):

    tor_snowflake_proxy_connections_total{country="IR"}   completed client connections
    tor_snowflake_proxy_connection_timeouts_total         clients matched but never connected
    tor_snowflake_proxy_traffic_inbound_bytes_total       received, in KB (despite the name)
    tor_snowflake_proxy_traffic_outbound_bytes_total      sent, in KB (despite the name)

The proxy only adds to these counters once per `-summary-interval` (default 1h), so they move in steps.
"""

import collections
import re
import threading
import time
import urllib.request
from typing import Any, Deque, Dict, List, NamedTuple, Optional, Tuple

METRICS_PATH = '/internal/metrics'
PREFIX = 'tor_snowflake_proxy_'
KB = 1000           # see formatTraffic() in snowflake/proxy/lib/util.go

POLL_S = 30         # how often the endpoint is read
KEEP_S = 6 * 3600   # how much history is kept in memory
TIMEOUT_S = 5

_LINE = re.compile(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(\S+)')
_LABEL = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"')


class Totals(NamedTuple):
    connections: int
    timeouts: int
    inbound: int        # bytes
    outbound: int       # bytes
    countries: Dict[str, int]


def metrics_url(host: str, port: str) -> str:
    if ':' in host and not host.startswith('['):
        host = f'[{host}]'      # IPv6
    return f'http://{host}:{port}{METRICS_PATH}'


def parse(text: str) -> Optional[Totals]:
    """Prometheus text format -> Totals. None if no Snowflake counters are in it."""
    found = False
    connections = timeouts = inbound = outbound = 0.0
    countries: Dict[str, int] = {}

    for line in text.splitlines():
        if not line.startswith(PREFIX):
            continue
        m = _LINE.match(line)
        if m is None:
            continue
        name, labels, value = m.group(1)[len(PREFIX):], m.group(2) or '', m.group(3)
        try:
            v = float(value)
        except ValueError:
            continue
        found = True
        if name == 'connections_total':
            connections += v
            country = dict(_LABEL.findall(labels)).get('country') or '??'
            countries[country.upper()] = countries.get(country.upper(), 0) + int(v)
        elif name == 'connection_timeouts_total':
            timeouts += v
        elif name == 'traffic_inbound_bytes_total':
            inbound += v
        elif name == 'traffic_outbound_bytes_total':
            outbound += v

    if not found:
        return None
    return Totals(int(connections), int(timeouts), int(inbound * KB), int(outbound * KB), countries)


def fetch(url: str, timeout: float = TIMEOUT_S) -> str:
    # no proxy: the endpoint is reached directly (firewalled to the Box's IP)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=timeout) as res:
        if res.status != 200:
            raise OSError(f'HTTP {res.status}')
        return res.read(1 << 20).decode('utf-8', 'replace')


class _Point(NamedTuple):
    t: float
    totals: Totals


class Monitor:
    """History of one proxy. read() is cheap; refresh() does the network call (run it off the request thread)."""

    def __init__(self, url: str):
        self.url = url
        self.points: Deque[_Point] = collections.deque()
        self.started: Optional[float] = None    # first successful read
        self.last_try = 0.0
        self.error: Optional[str] = None
        self.lock = threading.Lock()

    def due(self) -> bool:
        return time.time() - self.last_try >= POLL_S

    def refresh(self) -> None:
        self.last_try = time.time()
        try:
            totals = parse(fetch(self.url))
            if totals is None:
                raise ValueError('This endpoint has no Snowflake counters. Is the proxy started with -metrics?')
        except Exception as exc:
            with self.lock:
                self.error = str(exc) or exc.__class__.__name__
            return

        now = time.time()
        with self.lock:
            self.error = None
            if self.started is None:
                self.started = now
            last = self.points[-1].totals if self.points else None
            # store changes only: the proxy updates its counters once per summary interval
            if last is None or totals != last:
                self.points.append(_Point(now, totals))
            while self.points and now - self.points[0].t > KEEP_S:
                self.points.popleft()

    def read(self) -> Dict[str, Any]:
        with self.lock:
            points = list(self.points)
            error, started = self.error, self.started

        if not points:
            return {'state': 'offline' if error else 'connecting', 'error': error}

        now = time.time()
        latest = points[-1].totals

        # deltas between changes; a counter that went down means the proxy restarted
        history: List[Dict[str, float]] = []
        hour = {'connections': 0, 'timeouts': 0, 'inbound': 0, 'outbound': 0}
        last_client: Optional[float] = None
        for prev, cur in zip(points, points[1:]):
            d = _delta(prev.totals, cur.totals)
            dt = max(cur.t - prev.t, 1.0)
            history.append({'s': cur.t * 1000, 'r': d[2] / dt, 'w': d[3] / dt})
            if d[0] > 0:
                last_client = cur.t
            if now - cur.t <= 3600:
                for i, k in enumerate(hour):
                    hour[k] += d[i]

        countries = sorted(latest.countries.items(), key=lambda kv: -kv[1])
        attempts = hour['connections'] + hour['timeouts']

        issues = []
        if error:
            issues.append('Metrics not reachable')
        observed = now - (started or now)
        if observed >= 3 * 3600 and (last_client is None or now - last_client > 3 * 3600):
            issues.append('No clients for 3 hours')
        if attempts >= 10 and hour['timeouts'] / attempts > 0.5:
            issues.append('Most clients time out')

        return {
            'state': 'offline' if error else 'ok',
            'error': error,
            'health': {'status': 'warn' if issues else 'ok', 'issues': issues},
            'snowflake': {
                'connections': latest.connections,
                'timeouts': latest.timeouts,
                'inbound': latest.inbound,
                'outbound': latest.outbound,
                'connections_1h': hour['connections'],
                'timeouts_1h': hour['timeouts'],
                'inbound_1h': hour['inbound'],
                'outbound_1h': hour['outbound'],
                'countries': [{'cc': c, 'n': n} for c, n in countries[:8]],
                'updated': points[-1].t * 1000,
                'observed_s': int(observed),
                'history': history[-60:],
            },
        }


def _delta(a: Totals, b: Totals) -> Tuple[int, int, int, int]:
    def d(x: int, y: int) -> int:
        return y - x if y >= x else y     # reset: count from zero
    return (d(a.connections, b.connections), d(a.timeouts, b.timeouts),
            d(a.inbound, b.inbound), d(a.outbound, b.outbound))
