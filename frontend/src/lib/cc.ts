export interface BwSample { s: number; r: number; w: number }

export interface CCNode {
  id: string
  is_default: boolean
  label: string | null
  control: 'port' | 'socket' | 'proxy' | null
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
  mode?: 'Client' | 'Relay' | 'Bridge'
  flags?: string[]
  hibernating?: string | null
  fingerprint?: string | null
  circuits?: number
  connections?: number
  streams?: number
  bw?: BwSample[]
}

export interface CCList { tick: number; readonly: boolean; nodes: CCNode[] }

export interface NodeForm {
  label: string
  control: 'port' | 'socket' | 'proxy'
  host: string
  port: string
  password?: string | null   // undefined = keep, '' / null = remove
  cookie?: string | null
  control_cookie?: string | null   // Tor's control_auth_cookie as hex
}

export class ApiError extends Error {}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data: any = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(data?.error ?? `HTTP ${res.status}`)
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
