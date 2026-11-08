import io
from urllib.parse import urlencode

from theonionbox.tob.access import AccessGate, COOKIE, MAX_FAILURES, SESSION_SECONDS


def backend(environ, start_response):
    start_response('200 OK', [('Content-Type', 'text/plain')])
    return [b'SECRET DASHBOARD']


class Client:
    def __init__(self, app, ip='203.0.113.9'):
        self.app, self.ip, self.cookie = app, ip, None

    def request(self, method='GET', path='/', query='', form=None, html=True, cookie=None, headers=None):
        body = urlencode(form).encode() if form else b''
        environ = {
            'REQUEST_METHOD': method, 'PATH_INFO': path, 'QUERY_STRING': query, 'REMOTE_ADDR': self.ip,
            'wsgi.input': io.BytesIO(body), 'CONTENT_LENGTH': str(len(body)), 'wsgi.url_scheme': 'http',
            'HTTP_ACCEPT': 'text/html' if html else 'application/json',
        }
        c = cookie if cookie is not None else self.cookie
        if c:
            environ['HTTP_COOKIE'] = f'{COOKIE}={c}'
        environ.update(headers or {})
        out = {}

        def start(status, hdrs):
            out['status'], out['headers'] = status, dict((k, v) for k, v in hdrs)
            out['set_cookie'] = [v for k, v in hdrs if k == 'Set-Cookie']

        out['body'] = b''.join(self.app(environ, start)).decode()
        out['code'] = int(out['status'].split()[0])
        return out

    def login(self, password='hunter2', next='/'):
        r = self.request('POST', '/__access', form={'password': password, 'next': next})
        if r['code'] == 303:
            self.cookie = r['set_cookie'][0].split(';')[0].split('=', 1)[1]
        return r


def gate(**kw):
    clock = {'t': 1_000_000.0}
    g = AccessGate(backend, 'hunter2', now=lambda: clock['t'], **kw)
    g.clock = clock
    return g


def test_everything_is_closed_without_login():
    c = Client(gate())
    r = c.request('GET', '/abc/cc.html')
    assert r['code'] == 303 and '/__access?next=' in r['headers']['Location']
    assert 'SECRET' not in r['body']
    # scripted / XHR style requests get a plain 401 instead of a redirect
    assert c.request('POST', '/abc/data.html', html=False)['code'] == 401
    assert c.request('GET', '/abc/api/overview', html=False)['code'] == 401


def test_login_flow_and_cookie_flags():
    c = Client(gate())
    r = c.login()
    assert r['code'] == 303 and r['headers']['Location'] == '/'
    flags = r['set_cookie'][0]
    assert 'HttpOnly' in flags and 'SameSite=Lax' in flags and 'Secure' not in flags
    assert 'SECRET DASHBOARD' in c.request('GET', '/anything')['body']


def test_secure_flag_behind_https_proxy():
    c = Client(gate())
    r = c.request('POST', '/__access', form={'password': 'hunter2'}, headers={'HTTP_X_FORWARDED_PROTO': 'https'})
    assert 'Secure' in r['set_cookie'][0]


def test_wrong_password_is_rejected_and_rate_limited():
    c = Client(gate())
    for _ in range(MAX_FAILURES):
        assert c.login('nope')['code'] == 401
    blocked = c.login('hunter2')  # even the right one is refused while blocked
    assert blocked['code'] == 429 and not blocked['set_cookie']


def test_lockout_expires_and_is_per_client():
    g = gate()
    a, b = Client(g, '198.51.100.1'), Client(g, '198.51.100.2')
    for _ in range(MAX_FAILURES):
        a.login('nope')
    assert b.login()['code'] == 303          # someone else is not affected
    g.clock['t'] += 400
    assert a.login()['code'] == 303          # window passed


def test_forged_tampered_and_expired_cookies_are_rejected():
    g = gate()
    c = Client(g)
    c.login()
    good = c.cookie
    expiry, sig = good.split('.')
    assert c.request('GET', '/', cookie=f'{expiry}.{"0" * 64}')['code'] == 303
    assert c.request('GET', '/', cookie=f'{int(expiry) + 99999}.{sig}')['code'] == 303
    assert c.request('GET', '/', cookie='garbage')['code'] == 303
    g.clock['t'] += SESSION_SECONDS + 1
    assert c.request('GET', '/')['code'] == 303


def test_cookie_of_another_password_is_rejected():
    other = AccessGate(backend, 'different', now=lambda: 1_000_000.0)
    c = Client(other)
    c.login('different')
    assert Client(gate()).request('GET', '/', cookie=c.cookie)['code'] == 303


def test_no_open_redirect():
    for evil in ('//evil.example', 'https://evil.example', '/\\evil.example'):
        c = Client(gate())
        r = c.login(next=evil)
        assert r['headers']['Location'] == '/', evil


def test_login_page_escapes_next():
    r = Client(gate()).request('GET', '/__access', query='next=%22%3E%3Cscript%3Ealert(1)%3C/script%3E')
    assert '<script>' not in r['body']


def test_health_is_open_and_base_path_is_honoured():
    g = gate(base_path='/tob')
    c = Client(g)
    assert c.request('GET', '/__health')['code'] == 200
    r = c.request('GET', '/abc/')
    assert r['headers']['Location'].startswith('/tob/__access?next=%2Ftob%2Fabc%2F')
    assert c.login(next='/abc/')['headers']['Location'] == '/tob/abc/'


def test_health_check_works_without_a_gate():
    from theonionbox.tob.access import HealthCheck
    c = Client(HealthCheck(backend))
    assert c.request('GET', '/__health')['body'] == 'ok'
    assert 'SECRET' in c.request('GET', '/anything')['body']       # everything else passes through
