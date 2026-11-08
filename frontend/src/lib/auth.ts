import { md5 } from 'js-md5'

/**
 * The Box's login handshake (see tob/authenticate.py):
 *   1. GET login.html            -> 401 + `WWW-Authenticate: TheOnionBox realm=..., nonce=..., opaque=...`
 *   2. GET login.html + Authorization -> 200, body = id of the new, authenticated session
 * 'digest': the password never leaves the browser, only a hash of it (the Box knows the password and verifies it).
 * 'basic':  the Box forwards the password to Tor.
 * Step 2 has to follow step 1 within 1.5 seconds.
 */

export class LoginFailed extends Error {}

function parseChallenge(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  const [scheme, rest = ''] = header.split(/\s+(.*)/s)
  out.scheme = scheme
  for (const part of rest.split(',')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim().replace(/^"|"$/g, '')
  }
  return out
}

export async function login(sessionId: string, password: string, auth: 'digest' | 'basic', proceedTo: string): Promise<string> {
  const url = 'login.html'
  const uri = new URL(url, document.baseURI).pathname

  const first = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
  if (first.status !== 401) throw new LoginFailed('Unexpected answer from the Box.')
  const c = parseChallenge(first.headers.get('WWW-Authenticate'))

  let header: string
  if (auth === 'digest') {
    if (!c.nonce || !c.realm) throw new LoginFailed('The Box sent no challenge.')
    const ha1 = md5(`${sessionId}:${c.realm}:${password}`)
    const ha2 = md5(`GET:${uri}`)
    const response = md5(`${ha1}:${c.nonce}:${ha2}`)
    header = `${c.scheme} username="${sessionId}", realm="${c.realm}", nonce="${c.nonce}", uri="${uri}", response="${response}"`
  } else {
    const bytes = new TextEncoder().encode(`${sessionId}:${password}`)
    header = `${c.scheme || 'TheOnionBox'} ${btoa(String.fromCharCode(...bytes))}`
  }

  const second = await fetch(url, { headers: { Authorization: header }, credentials: 'same-origin', cache: 'no-store' })
  const id = (await second.text()).trim()
  if (!second.ok || !/^[0-9a-f]{32}$/.test(id)) throw new LoginFailed('Wrong password.')
  return new URL(`../${id}/${proceedTo}`, document.baseURI).toString()
}
