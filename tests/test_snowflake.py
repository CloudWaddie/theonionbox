"""Snowflake proxy monitoring: parsing the metrics endpoint, history, and the ControlCenter wiring."""

import http.server
import threading
import time

import pytest

from theonionbox.tob import snowflake
from theonionbox.tob.apps.controlcenter import ControlCenter, ValidationError, validate_node

METRICS = '''# HELP tor_snowflake_proxy_connections_total The total number of successful connections
# TYPE tor_snowflake_proxy_connections_total counter
tor_snowflake_proxy_connections_total{country="IR"} 12
tor_snowflake_proxy_connections_total{country="ru"} 3
tor_snowflake_proxy_connection_timeouts_total 2
tor_snowflake_proxy_traffic_inbound_bytes_total 4096
tor_snowflake_proxy_traffic_outbound_bytes_total 1.5e+03
go_goroutines 12
'''


def test_parse_sums_countries_and_converts_kb():
    t = snowflake.parse(METRICS)
    assert t.connections == 15 and t.timeouts == 2
    assert t.countries == {'IR': 12, 'RU': 3}
    assert t.inbound == 4_096_000 and t.outbound == 1_500_000     # the proxy counts KB


def test_parse_without_snowflake_counters():
    assert snowflake.parse('go_goroutines 12\n') is None
    assert snowflake.parse('') is None


def test_metrics_url_brackets_ipv6():
    assert snowflake.metrics_url('10.0.0.5', '9999') == 'http://10.0.0.5:9999/internal/metrics'
    assert snowflake.metrics_url('2001:db8::1', '9999') == 'http://[2001:db8::1]:9999/internal/metrics'


def _monitor(*totals, started_ago=600):
    m = snowflake.Monitor('http://unused')
    now = time.time()
    m.started = now - started_ago
    for i, t in enumerate(totals):
        m.points.append(snowflake._Point(now - 60 * (len(totals) - 1 - i), t))
    return m


def test_read_counts_the_last_hour_and_survives_a_restart():
    a = snowflake.parse(METRICS)
    b = a._replace(connections=20, inbound=6_000_000)
    restarted = a._replace(connections=2, inbound=500_000, timeouts=0)
    s = _monitor(a, b, restarted).read()['snowflake']
    assert s['connections_1h'] == 5 + 2
    assert s['inbound_1h'] == (6_000_000 - 4_096_000) + 500_000
    assert len(s['history']) == 2 and all(p['r'] >= 0 for p in s['history'])
    assert s['countries'][0] == {'cc': 'IR', 'n': 12}


def test_warns_when_no_clients_for_hours():
    a = snowflake.parse(METRICS)
    r = _monitor(a, started_ago=4 * 3600).read()
    assert r['health']['status'] == 'warn' and 'No clients for 3 hours' in r['health']['issues']


def test_warns_when_most_clients_time_out():
    a = snowflake.parse(METRICS)
    b = a._replace(connections=a.connections + 2, timeouts=a.timeouts + 10)
    r = _monitor(a, b).read()
    assert 'Most clients time out' in r['health']['issues']


def test_unreachable_before_first_read_is_offline():
    m = snowflake.Monitor('http://127.0.0.1:1/internal/metrics')
    m.refresh()
    assert m.read()['state'] == 'offline' and m.read()['error']


def test_snowflake_node_needs_host_and_port():
    out = validate_node({'control': 'snowflake', 'host': '203.0.113.7', 'port': '9999'})
    assert out['control'] == 'snowflake' and out['port'] == '9999'
    with pytest.raises(ValidationError):
        validate_node({'control': 'snowflake', 'host': '203.0.113.7', 'port': ''})


@pytest.fixture
def endpoint():
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = METRICS.encode() if self.path == snowflake.METRICS_PATH else b''
            self.send_response(200 if body else 404)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield '127.0.0.1', str(server.server_address[1])
    server.shutdown()


def test_monitor_reads_a_live_endpoint(endpoint):
    m = snowflake.Monitor(snowflake.metrics_url(*endpoint))
    m.refresh()
    r = m.read()
    assert r['state'] == 'ok' and r['snowflake']['connections'] == 15


def test_connection_test_finds_the_proxy(endpoint):
    result = ControlCenter._test_snowflake(*endpoint)
    assert result['ok'] is True and '15 connections' in result['message']
    assert ControlCenter._test_snowflake('127.0.0.1', '1')['ok'] is False
