"""Boots the real Box in ControlCenter mode (no Tor required) and walks through the web interface's HTTP API."""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


@pytest.fixture(scope='module')
def box(tmp_path_factory):
    tmp = tmp_path_factory.mktemp('box')
    cc = tmp / 'cc.cfg'
    cc.write_text('')
    data = tmp / 'data'
    data.mkdir()
    port = free_port()
    cfg = tmp / 'tob.cfg'
    cfg.write_text(f'[TheOnionBox]\nhost = 127.0.0.1\nport = {port}\npersistance_dir = {data}\n[Tor]\ncontrol = port\nport = 1\n')

    env = {**os.environ, 'TOB_ACCESS_PASSWORD': 'letmein', 'HOME': str(tmp)}
    proc = subprocess.Popen([sys.executable, '-m', 'theonionbox', '-c', str(cfg), '-x', str(cc)],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = f'http://127.0.0.1:{port}'
    for _ in range(100):
        try:
            urllib.request.urlopen(base + '/__health', timeout=1)
            break
        except OSError:
            if proc.poll() is not None:
                pytest.fail('Box exited early:\n' + proc.stdout.read())
            time.sleep(0.2)
    else:
        proc.kill()
        pytest.fail('Box did not start')
    yield base
    proc.terminate()
    proc.wait(10)


class Browser:
    """Behaves like a browser: cookie jar, follows redirects."""

    def __init__(self, base):
        import http.cookiejar
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def open(self, path, data=None, method=None, json_body=None, accept='text/html'):
        body = None
        headers = {'Accept': accept, 'User-Agent': 'smoke'}
        if json_body is not None:
            body, headers['Content-Type'] = json.dumps(json_body).encode(), 'application/json'
        elif data is not None:
            body = '&'.join(f'{k}={v}' for k, v in data.items()).encode()
        req = urllib.request.Request(self.base + path, data=body, headers=headers, method=method)
        try:
            res = self.opener.open(req, timeout=10)
        except urllib.error.HTTPError as e:
            res = e
        return res.status, res.url, res.read().decode()


def test_everything_is_behind_the_access_gate(box):
    b = Browser(box)
    status, url, _ = b.open('/')
    assert '/__access' in url                       # redirected to the sign-in page
    assert b.open('/__access', data={'password': 'wrong'})[0] == 401
    status, url, body = b.open('/__access', data={'password': 'letmein'})
    assert status == 200 and '/cc.html' in url      # signed in -> new session -> ControlCenter
    assert '<base href="/' in body and 'id="root"' in body


def test_pages_state_assets_and_node_api(box):
    b = Browser(box)
    b.open('/__access', data={'password': 'letmein'})
    _, url, html = b.open('/')
    sid = url.split('/')[3]

    state = json.loads(b.open(f'/{sid}/api/state', accept='application/json')[2])
    assert state['page'] == 'cc'

    # the built assets are served - to a session only
    import re
    asset = re.search(r'(?:\./)?(assets/index-[^"]+\.js)', html).group(1)
    assert b.open(f'/{sid}/{asset}')[0] == 200
    _, bounced, content = b.open(f'/{"0" * 32}/{asset}')       # unknown session: bounced to a fresh start
    assert asset not in bounced and '<base href=' in content

    api = lambda path, **kw: json.loads(b.open(f'/{sid}/api/cc/{path}', accept='application/json', **kw)[2])

    assert api('nodes')['nodes'] == []              # a container has no Tor of its own: no phantom card

    added = api('nodes', method='POST', json_body={'label': 'r1', 'control': 'port', 'host': '127.0.0.1', 'port': 1})
    node = next(n for n in api('nodes')['nodes'] if n['id'] == added['id'])
    assert node['label'] == 'r1' and node['has_password'] is False and node['editable'] is True
    assert 'password' not in node

    api(f'nodes/{added["id"]}', method='PUT', json_body={'password': 'pw'})
    assert next(n for n in api('nodes')['nodes'] if n['id'] == added['id'])['has_password'] is True

    for _ in range(40):                             # port 1 is closed: the node ends up offline, nothing hangs
        node = next(n for n in api('nodes')['nodes'] if n['id'] == added['id'])
        if node['state'] != 'connecting':
            break
        time.sleep(0.25)
    assert node['state'] == 'offline'

    bad = b.open(f'/{sid}/api/cc/nodes', method='POST', json_body={'control': 'port', 'host': 'x\ny', 'port': 1},
                 accept='application/json')
    assert bad[0] == 400

    api(f'nodes/{added["id"]}', method='DELETE')
    assert api('nodes')['nodes'] == []
