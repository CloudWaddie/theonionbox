"""ControlCenter: input validation & the node file (the part that is easy to break and costly to lose)."""

import pytest

from theonionbox.tob.apps.controlcenter import ValidationError, validate_node
from theonionbox.tob.ccfile import CCFile


def good(**kw):
    return {'label': 'relay', 'control': 'port', 'host': '10.0.0.5', 'port': 9051, **kw}


def test_valid_node_is_normalised():
    out = validate_node(good(label='  relay  ', port='9051'))
    assert out['label'] == 'relay' and out['port'] == '9051' and out['host'] == '10.0.0.5'


def test_empty_label_and_missing_secrets():
    out = validate_node(good(label=''))
    assert out['label'] is None and 'password' not in out      # absent = unchanged on edit


def test_empty_secret_clears():
    assert validate_node(good(password=''))['password'] is None


@pytest.mark.parametrize('bad', [
    good(control='ssh'), good(host=''), good(port=0), good(port=70000), good(port='abc'), good(port=None),
    good(host='a\nb'), good(label='x\r\n[evil]\npassword = 1'), good(password='pw\nhost = evil'),
    good(cookie='short'), good(host='h' * 300),
])
def test_invalid_input_is_rejected(bad):
    with pytest.raises(ValidationError):
        validate_node(bad)


def test_control_cookie_is_validated_and_normalised():
    cookie = 'AB' * 32
    assert validate_node(good(control_cookie=cookie))['control_cookie'] == cookie.lower()
    assert validate_node(good(control_cookie=''))['control_cookie'] is None
    for bad in ('ab' * 31, 'zz' * 32, 'ab' * 33, 'ab' * 32 + '\n[x]'):
        with pytest.raises(ValidationError):
            validate_node(good(control_cookie=bad))


def test_cookie_file_is_private_and_removed():
    import os, stat
    from theonionbox.tob.apps.controlcenter import _cookie_file
    with _cookie_file('00ff' * 16) as path:
        assert open(path, 'rb').read() == bytes.fromhex('00ff' * 16)
        assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert not os.path.exists(path)


def test_socket_needs_no_port():
    out = validate_node({'control': 'socket', 'host': '/var/run/tor/control', 'port': ''})
    assert out['port'] is None


def test_partial_edit_only_returns_what_was_sent():
    assert validate_node({'label': 'new'}, partial=True) == {'label': 'new'}


@pytest.fixture
def ccfile(tmp_path):
    f = tmp_path / 'cc.cfg'
    f.write_text('')
    return CCFile(str(f)), f


def test_file_roundtrip_reorder_and_remove(ccfile):
    cc, path = ccfile
    a, b, c = (cc.add_node() for _ in range(3))
    for node, name in ((a, 'a'), (b, 'b'), (c, 'c')):
        node.label, node.control, node.host, node.port = name, 'port', f'10.0.0.{ord(name)}', '9051'
        node.tick()
    b.password = 'secret'
    b.tick()

    assert [n.label for n in cc] == ['a', 'b', 'c']
    c.move_after(None)                       # first
    assert [n.label for n in CCFile(str(path))] == ['c', 'a', 'b']
    assert 'password = secret' in path.read_text()

    assert b.remove() is True
    b.tick()
    assert [n.label for n in CCFile(str(path))] == ['c', 'a']


def test_checking_writability_never_truncates_the_file(ccfile):
    cc, path = ccfile
    n = cc.add_node()
    n.label, n.control, n.host, n.port = 'x', 'port', 'h', '1'
    n.tick()
    before = path.read_text()
    for _ in range(5):
        cc.readonly
    assert path.read_text() == before and before


def test_read_only_file_is_reported(tmp_path):
    f = tmp_path / 'ro.cfg'
    f.write_text('')
    f.chmod(0o444)
    import os
    if os.geteuid() == 0:
        pytest.skip('root can write anything')
    assert CCFile(str(f)).readonly is True
