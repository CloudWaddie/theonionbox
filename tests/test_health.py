"""Bridge info & relay health checks. A fake controller stands in for Tor."""

from types import SimpleNamespace

from theonionbox.tob import health


class FakeTor:
    version_short = '0.4.9.11'
    version_current = 'recommended'
    flags = ['Fast', 'Running', 'Stable', 'Valid']

    def __init__(self, conf=None, info=None):
        self.conf = {'ORPort': '9001', 'ContactInfo': 'me@example.org'}
        self.conf.update(conf or {})
        self.info = {
            'status/reachability-succeeded': 'OR=1 DIR=1',
            'status/good-server-descriptor': '1',
            'uptime': str(5 * 86400),
        }
        self.info.update(info or {})

    def get_conf(self, key, default=None, multiple=False):
        value = self.conf.get(key, default)
        if multiple and isinstance(value, str):
            return [value]
        return value

    def get_info(self, key, default=None):
        if key not in self.info:
            raise KeyError(key)
        return self.info[key]

    def is_localhost(self):
        return False


def by_id(result):
    return {c['id']: c for c in result['checks']}


def test_healthy_relay():
    result = health.health(FakeTor(), latest_stable='0.4.9.11')
    assert result['status'] == health.OK
    assert all(c['status'] == health.OK for c in result['checks'])


def test_clients_have_nothing_to_check():
    assert health.health(FakeTor(conf={'ORPort': None})) is None


def test_unreachable_orport_fails():
    result = health.health(FakeTor(info={'status/reachability-succeeded': 'OR=0 DIR=0'}))
    assert result['status'] == health.FAIL
    assert by_id(result)['reachability']['status'] == health.FAIL


def test_reachability_not_tested_yet_is_only_a_warning():
    class Untested(FakeTor):
        def get_info(self, key, default=None):
            if key == 'status/reachability-succeeded':
                raise KeyError(key)
            return super().get_info(key, default)

    assert by_id(health.health(Untested()))['reachability']['status'] == health.WARN


def test_obsolete_tor_fails():
    tor = FakeTor()
    tor.version_current = 'obsolete'
    assert by_id(health.health(tor))['version']['status'] == health.FAIL


def test_newer_tor_available_warns():
    assert by_id(health.health(FakeTor(), latest_stable='0.4.10.1'))['version']['status'] == health.WARN


def test_flags():
    tor = FakeTor()
    tor.flags = ['Running']
    assert by_id(health.health(tor))['flags']['status'] == health.FAIL      # Valid missing
    tor.flags = ['Running', 'Valid']
    assert by_id(health.health(tor))['flags']['status'] == health.WARN      # no Fast / Stable yet


def test_contact_info_and_recent_restart():
    result = health.health(FakeTor(conf={'ContactInfo': ''}, info={'uptime': '600'}))
    checks = by_id(result)
    assert checks['contact']['status'] == health.WARN
    assert checks['uptime']['status'] == health.WARN


def test_hibernation_warns():
    result = health.health(FakeTor(), accounting_stats=SimpleNamespace(status='soft'))
    assert by_id(result)['hibernation']['status'] == health.WARN


def test_contact_differs_from_onionoo():
    class OO:
        def has_data(self):
            return True

        def __call__(self, key):
            return {'running': True, 'contact': 'someone else'}[key]

    assert by_id(health.health(FakeTor(), oo_details=OO()))['contact']['status'] == health.WARN


def test_clients_seen_is_parsed():
    out = health.clients_seen('TimeStarted="2026-11-07 10:00:00" CountrySummary=us=16,de=8,ru=24 IPVersions=v4=40,v6=8')
    assert out['since'] == '2026-11-07 10:00:00'
    assert out['countries'][0] == {'country': 'RU', 'count': 24}
    assert out['total'] == 48
    assert out['ip_versions'] == {'v4': 40, 'v6': 8}
    assert health.clients_seen('') is None


def test_bridge_info():
    tor = FakeTor(conf={
        'BridgeRelay': '1', 'ServerTransportPlugin': 'obfs4 exec /usr/bin/obfs4proxy',
        'ServerTransportListenAddr': 'obfs4 0.0.0.0:443', 'BridgeDistribution': 'any',
    }, info={'status/clients-seen': 'TimeStarted="x" CountrySummary=us=8'})
    info = health.bridge(tor)
    assert info['transports'] == [{'name': 'obfs4', 'listen': '0.0.0.0:443', 'plugin': 'exec /usr/bin/obfs4proxy'}]
    assert info['distribution'] == 'any'
    assert info['reachable'] is True
    assert info['clients']['total'] == 8
    assert info['bridge_line'] is None          # not running next to tor


def test_bridge_info_only_for_bridges():
    assert health.bridge(FakeTor()) is None
