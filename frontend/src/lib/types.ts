export interface TorInfo {
  version: string | null
  version_short: string
  version_status: string
  latest_stable: string | null
  latest_unstable: string | null
  is_latest_stable: boolean | null
  is_latest_unstable: boolean | null
  pid: number | null
  user: string | null
  nickname: string | null
  mode: 'Client' | 'Relay' | 'Bridge'
  fingerprint: string | null
  flags: string[]
  is_localhost: boolean
  hibernating: boolean
}

export interface HostInfo {
  name: string | null
  os: string | null
  os_version: string | null
  system: string | null
  uptime: string | null
  cpu_count: number
  memory_mb: number | null
  temperature: boolean
}

export interface NetworkInfo {
  type: 'Relay' | 'Bridge'
  fingerprint: string | null
  nickname: string | null
  platform: string | null
  contact: string | null
  or_addresses: string[]
  exit_addresses: string[]
  dir_address: string | null
  first_seen: string | null
  last_seen: string | null
  last_restarted: string | null
  last_changed: string | null
  running: boolean | null
  hibernating: boolean | null
  flags: string[]
  as_number: string | null
  as_name: string | null
  host_name: string | null
  published: string | null
  location: Record<string, string | number | null>
}

export interface Overview {
  token: string
  box: { version: string }
  cc?: boolean
  header: { title: string; location: string; tor_version: string; fingerprint: string | null; logout: boolean }
  sections: string[]
  tor: TorInfo
  host: HostInfo | null
  accounting: { enabled: boolean }
  config: { name: string; values: string[] }[]
  hidden_services: { dir: string; options: Record<string, unknown> }[]
  network: NetworkInfo | null
  intervals: Record<string, number>
  transport: { or: number; circ: number; stream: number }
}

// GET api/state
export type PageState =
  | { page: 'login'; auth: 'digest' | 'basic'; proceed_to: string; label: string | null; box: string; cc: boolean }
  | { page: 'error'; message: string; box: string; cc: boolean }
  | { page: 'cc'; logout: boolean; box: string; cc: boolean }
  | { page: 'dashboard'; box: string; cc: boolean }

/* --- live data (POST data.html) --- */

export interface GenSample {
  s: number
  c: number
  mp: number
  t?: number
  [core: string]: number | undefined
}

export interface MonSample { s: number; r: number; w: number; tr?: number; tw?: number }

export interface AccStats {
  status: string
  read_bytes: number
  read_limit: number
  written_bytes: number
  write_limit: number
  time_until_reset: number
  interval_end: number
}

export interface LogEvent { s: number; l: string; m: string; t: string; c: number }

export type History = Record<string, [number, number | null][]>

export interface LiveResponse {
  tick: number
  token: string
  gen?: GenSample[]
  mon?: Record<string, MonSample[]>
  acc?: { enabled: boolean; stats?: AccStats }
  msg?: LogEvent[]
  msg_status?: Record<string, boolean>
  transport?: { or: number; circ: number; stream: number }
  oo_bw?: { read: History | null; write: History | null }
  oo_weights?: {
    cw: History | null
    cwf: History | null
    ep: History | null
    gp: History | null
    mp: History | null
    data: Record<string, number | null>
  }
}
