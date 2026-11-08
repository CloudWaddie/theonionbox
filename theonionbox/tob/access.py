"""password gate for the whole box. cookie login on purpose: the tor logins use the Authorization header, basic auth would clash"""

import hashlib
import hmac
import html
import time
from http.cookies import SimpleCookie
from urllib.parse import parse_qs, quote

COOKIE = 'tob_access'
LOGIN_PATH = '/__access'
HEALTH_PATH = '/__health'
SESSION_SECONDS = 12 * 3600
MAX_FAILURES = 5
FAILURE_WINDOW = 300  # seconds

_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>The Onion Box</title>
<style>
:root{{--bg:#fff;--fg:#171717;--muted:#666;--border:#eaeaea;--input:#dcdcdc;--danger:#e5484d;color-scheme:light}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0a0a0a;--fg:#ededed;--muted:#a1a1a1;--border:#262626;--input:#2e2e2e;--danger:#ff6369;color-scheme:dark}}}}
*{{box-sizing:border-box}}body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg)}}
main{{width:100%;max-width:380px;border:1px solid var(--border);border-radius:12px;padding:28px}}
h1{{font-size:20px;margin:0 0 4px;letter-spacing:-.02em}}p{{margin:0 0 20px;color:var(--muted);font-size:14px}}
label{{display:block;font-size:13px;font-weight:500;margin-bottom:6px}}
input{{width:100%;height:40px;padding:0 12px;font:inherit;color:inherit;background:transparent;border:1px solid var(--input);border-radius:8px}}
input:focus{{outline:2px solid color-mix(in srgb,var(--fg) 25%,transparent);border-color:var(--fg)}}
button{{width:100%;height:40px;margin-top:16px;font:inherit;font-weight:500;color:var(--bg);background:var(--fg);border:0;border-radius:8px;cursor:pointer}}
.err{{color:var(--danger);font-size:14px;margin:0 0 16px}}
</style></head><body><main>
<h1>The Onion Box</h1><p>This instance is protected. Please sign in.</p>
{error}
<form method="post" action="{action}">
<input type="hidden" name="next" value="{next}">
<label for="pw">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">Sign in</button>
</form></main></body></html>"""


def _safe_next(value: str) -> str:
    # no redirects off-site
    if not value or not value.startswith('/') or value.startswith('//') or '\\' in value:
        return '/'
    return value


class HealthCheck:
    """/__health for docker / coolify"""

    def __init__(self, app):
        self.app = app

    def __call__(self, environ, start_response):
        if environ.get('PATH_INFO') == HEALTH_PATH:
            start_response('200 OK', [('Content-Type', 'text/plain'), ('Content-Length', '2'),
                                      ('Cache-Control', 'no-store')])
            return [b'ok']
        return self.app(environ, start_response)


class AccessGate:

    def __init__(self, app, password: str, base_path: str = '', now=time.time):
        self.app = app
        self.base_path = (base_path or '').rstrip('/')
        self._key = hashlib.sha256(('tob-access-v1:' + password).encode('utf-8')).digest()
        self._password = password.encode('utf-8')
        self._now = now
        self._failures = {}

    def _sign(self, expiry: int) -> str:
        return hmac.new(self._key, str(expiry).encode(), hashlib.sha256).hexdigest()

    def _token(self) -> str:
        expiry = int(self._now()) + SESSION_SECONDS
        return f'{expiry}.{self._sign(expiry)}'

    def _valid(self, token: str) -> bool:
        try:
            expiry, signature = token.split('.', 1)
            return int(expiry) > self._now() and hmac.compare_digest(signature, self._sign(int(expiry)))
        except (ValueError, AttributeError):
            return False

    @staticmethod
    def _client(environ) -> str:
        fwd = environ.get('HTTP_X_FORWARDED_FOR', '')
        return fwd.split(',')[0].strip() if fwd else environ.get('REMOTE_ADDR', '?')

    @staticmethod
    def _secure(environ) -> bool:
        return environ.get('wsgi.url_scheme') == 'https' or environ.get('HTTP_X_FORWARDED_PROTO', '') == 'https'

    def _authenticated(self, environ) -> bool:
        raw = environ.get('HTTP_COOKIE', '')
        if not raw:
            return False
        try:
            jar = SimpleCookie(raw)
        except Exception:
            return False
        morsel = jar.get(COOKIE)
        return bool(morsel) and self._valid(morsel.value)

    def _blocked(self, client: str) -> bool:
        now = self._now()
        hits = [t for t in self._failures.get(client, []) if now - t < FAILURE_WINDOW]
        self._failures[client] = hits
        return len(hits) >= MAX_FAILURES

    @staticmethod
    def _respond(start_response, status, body=b'', headers=None):
        h = [('Content-Length', str(len(body))), ('Cache-Control', 'no-store')]
        h += headers or []
        start_response(status, h)
        return [body]

    def _login_page(self, start_response, next_url, error='', status='200 OK'):
        body = _PAGE.format(
            error=f'<p class="err">{html.escape(error)}</p>' if error else '',
            action=html.escape(self.base_path + LOGIN_PATH, quote=True),
            next=html.escape(next_url, quote=True),
        ).encode('utf-8')
        return self._respond(start_response, status, body, [('Content-Type', 'text/html; charset=utf-8'),
                                                            ('X-Frame-Options', 'DENY')])

    def __call__(self, environ, start_response):
        path = environ.get('PATH_INFO', '/')
        method = environ.get('REQUEST_METHOD', 'GET').upper()

        if path == HEALTH_PATH:
            return self._respond(start_response, '200 OK', b'ok', [('Content-Type', 'text/plain')])

        if path == LOGIN_PATH:
            return self._login(environ, start_response, method)

        if self._authenticated(environ):
            return self.app(environ, start_response)

        wants_html = 'text/html' in environ.get('HTTP_ACCEPT', '')
        if method in ('GET', 'HEAD') and wants_html:
            target = self.base_path + path + (('?' + environ['QUERY_STRING']) if environ.get('QUERY_STRING') else '')
            location = f'{self.base_path}{LOGIN_PATH}?next={quote(target, safe="")}'
            return self._respond(start_response, '303 See Other', b'', [('Location', location)])
        return self._respond(start_response, '401 Unauthorized', b'Authentication required.',
                             [('Content-Type', 'text/plain')])

    def _login(self, environ, start_response, method):
        query = parse_qs(environ.get('QUERY_STRING', ''))
        next_url = _safe_next(query.get('next', ['/'])[0])

        if method != 'POST':
            return self._login_page(start_response, next_url)

        client = self._client(environ)
        if self._blocked(client):
            return self._login_page(start_response, next_url, 'Too many attempts. Please wait a few minutes.',
                                    '429 Too Many Requests')

        try:
            length = min(int(environ.get('CONTENT_LENGTH') or 0), 4096)
        except ValueError:
            length = 0
        form = parse_qs(environ['wsgi.input'].read(length).decode('utf-8', 'replace'))
        given = form.get('password', [''])[0].encode('utf-8')
        next_url = _safe_next(form.get('next', [next_url])[0])

        # hash both so the compare doesn't leak the length
        if not hmac.compare_digest(hashlib.sha256(given).digest(), hashlib.sha256(self._password).digest()):
            self._failures.setdefault(client, []).append(self._now())
            return self._login_page(start_response, next_url, 'Wrong password.', '401 Unauthorized')

        self._failures.pop(client, None)
        cookie = f'{COOKIE}={self._token()}; Path={self.base_path or "/"}; Max-Age={SESSION_SECONDS}; HttpOnly; SameSite=Lax'
        if self._secure(environ):
            cookie += '; Secure'
        return self._respond(start_response, '303 See Other', b'',
                             [('Location', self.base_path + next_url), ('Set-Cookie', cookie)])
