"""Tests for the JSON overview used by the single page dashboard. No Tor needed: a tiny fake controller is used."""

import json

import pytest

from theonionbox.tob import api


class FakeTor:
    version_short = '0.4.9.11'
    version_current = 'recommended'
    nickname = 'testrelay'
    fingerprint = 'A' * 40
    user = 'tor'
    flags = ['Fast', 'Running']

    def __init__(self, recommended='0.4.8.17,0.4.9.11,0.4.10.2-alpha', conf=None):
        self._recommended = recommended
        self._conf = {'ORPort': '9001'} if conf is None else conf

    def get_info(self, key, default=None):
        if key == 'status/version/recommended':
            return self._recommended
        if key == 'address':
            return '203.0.113.7'
        raise KeyError(key)

    def get_conf(self, key, default=None):
        return self._conf.get(key, default)

    def get_version(self):
        return '0.4.9.11'

    def get_pid(self):
        return 42

    def is_localhost(self):
        return True

    def get_hidden_service_conf(self, default=None):
        return {'/var/lib/tor/hs': {'HiddenServicePort': ['80 127.0.0.1:8080']}}


def test_version_key_orders_prereleases_before_release():
    assert api._version_key('0.4.9.11') > api._version_key('0.4.9.2')
    assert api._version_key('0.4.10.1') > api._version_key('0.4.9.11')
    assert api._version_key('0.4.10.2-alpha') < api._version_key('0.4.10.2')


def test_latest_versions_come_from_tor_itself():
    stable, unstable = api.latest_tor_versions(FakeTor())
    assert stable == '0.4.9.11'
    assert unstable == '0.4.10.2-alpha'


def test_latest_versions_survive_a_tor_that_does_not_answer():
    class Mute(FakeTor):
        def get_info(self, key, default=None):
            raise RuntimeError('control port closed')

    assert api.latest_tor_versions(Mute()) == (None, None)


class Box:
    class Tor:  # unused by the API any more, kept so callers need not change
        pass


def test_tor_section_modes():
    relay = api.tor_section(FakeTor(), Box)
    assert relay['mode'] == 'Relay'
    assert relay['flags'] == ['Fast', 'Running']
    assert relay['is_latest_stable'] is True

    client = api.tor_section(FakeTor(conf={}), Box)
    assert client['mode'] == 'Client'
    assert client['flags'] == []

    bridge = api.tor_section(FakeTor(conf={'BridgeRelay': '1', 'ORPort': '9001'}), Box)
    assert bridge['mode'] == 'Bridge'


def test_config_section_is_sorted_and_stringified():
    out = api.config_section({'b': ['1'], 'a': None, 'c': 5})
    assert [c['name'] for c in out] == ['a', 'b', 'c']
    assert out[0]['values'] == []
    assert out[2]['values'] == ['5']


def test_build_overview_is_json_serialisable():
    overview = api.build_overview(
        tor=FakeTor(), box_version=Box, box_stamp='20.2', host=None, configs_used={'ORPort': ['9001']},
        accounting_stats=None, accounting_switch=False, oo_details=None, geoip=None,
        sections=['config', 'hiddenservice', 'monitor'], show_logout=True, token='t',
        intervals={'1s': 1}, transport={'or': 0, 'circ': 0, 'stream': 0},
    )
    json.dumps(overview)  # must not raise
    assert overview['token'] == 't'
    assert overview['header']['title'] == 'testrelay'
    assert overview['host'] is None and overview['network'] is None
    assert overview['hidden_services'][0]['dir'] == '/var/lib/tor/hs'
