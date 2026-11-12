export interface BwSample { s: number; r: number; w: number }

export interface CCNode {
  id: string
  is_default: boolean
  label: string | null
  control: 'port' | 'socket' | 'proxy' | 'snowflake' | null
  host: string | null
  port: string | null
  has_password: boolean
  has_cookie: boolean
  has_control_cookie: boolean
  editable: boolean
  state: 'ok' | 'connecting' | 'auth' | 'offline'
  error?: string
  nickname?: string
  version?: string
  version_status?: string
  mode?: 'Client' | 'Relay' | 'Bridge' | 'Snowflake'
  flags?: string[]
  hibernating?: string | null
  fingerprint?: string | null
  circuits?: number
  connections?: number
  streams?: number
  bw?: BwSample[]
  /** Lifetime traffic in bytes: up = uploaded/written, down = downloaded/read. */
  lifetime?: { up: number; down: number }
  health?: { status: 'ok' | 'warn' | 'fail'; issues: string[] } | null
  snowflake?: SnowflakeStats
}

/** Read from a Snowflake proxy's -metrics endpoint. Bytes; counters since the proxy started. */
export interface SnowflakeStats {
  connections: number
  timeouts: number
  inbound: number
  outbound: number
  connections_1h: number
  timeouts_1h: number
  inbound_1h: number
  outbound_1h: number
  countries: { cc: string; n: number }[]
  updated: number
  observed_s: number
  history: BwSample[]
}

export interface CCList { tick: number; readonly: boolean; nodes: CCNode[] }

export interface NodeForm {
  label: string
  control: 'port' | 'socket' | 'proxy' | 'snowflake'
  host: string
  port: string
  password?: string | null   // undefined = keep, '' / null = remove
  cookie?: string | null
  control_cookie?: string | null   // Tor's control_auth_cookie as hex
}

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message) }
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  // a request that hangs must not stall the polling for good
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl.signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    throw new ApiError(ctrl.signal.aborted ? 'The Box did not answer in time.' : 'The Box cannot be reached.', 0)
  } finally {
    clearTimeout(timer)
  }
  let data: any = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(data?.error ?? (res.status === 404 ? 'This session has ended.' : `HTTP ${res.status}`), res.status)
  return data as T
}

export const ccApi = {
  list: (since?: number) => call<CCList>(`api/cc/nodes${since ? `?since=${since}` : ''}`),
  add: (n: NodeForm) => call<{ id: string }>('api/cc/nodes', 'POST', n),
  edit: (id: string, n: Partial<NodeForm>) => call<{ id: string }>(`api/cc/nodes/${id}`, 'PUT', n),
  remove: (id: string) => call<{ id: string }>(`api/cc/nodes/${id}`, 'DELETE'),
  order: (order: string[]) => call<{ ok: boolean }>('api/cc/order', 'POST', { order }),
  open: (id: string) => call<{ path: string }>(`api/cc/nodes/${id}/open`, 'POST', {}),
  test: (n: Pick<NodeForm, 'control' | 'host' | 'port' | 'cookie'>) =>
    call<{ ok: boolean; message: string; methods: string[] }>('api/cc/test', 'POST', n),
}
