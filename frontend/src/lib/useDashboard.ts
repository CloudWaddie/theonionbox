import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AccStats, HealthResponse, GenSample, History, LiveResponse, LogEvent, MonSample, Overview } from './types'
import { decodeEntities } from './format'

export interface LiveState {
  connected: boolean
  expired: boolean
  // time of the last answer of the Box, browser clock
  lastUpdate: number | null
  gen: GenSample[]
  mon: Record<string, MonSample[]>
  acc: { enabled: boolean; stats?: AccStats } | null
  logs: LogEntry[]
  levels: Record<string, boolean>
  transport: { or: number; circ: number; stream: number }
  ooBw: { read: History | null; write: History | null } | null
  ooWeights: NonNullable<LiveResponse['oo_weights']> | null
}

export type LogEntry = LogEvent & { id: number }

const POLL_MS = 2000
// a hidden tab only keeps its session alive (sessions end after 30s of silence by default)
const HIDDEN_MS = 10_000
const TIMEOUT_MS = 15_000
const LIMITS = { gen: 900, mon: 1500, logs: 500 }

function tail<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(list.length - max) : list
}

// The Box sends its whole history with each of the first two answers, and a retried request may repeat samples:
// only take what is newer than what we have.
function appendNewer<T extends { s: number }>(list: T[], extra: T[] | undefined, shift: number, max: number): T[] {
  if (!extra || extra.length === 0) return list
  const last = list.length ? list[list.length - 1].s : -Infinity
  const fresh: T[] = []
  for (const p of extra) {
    const s = p.s + shift
    if (s > last) fresh.push({ ...p, s })
  }
  return fresh.length ? tail(list.concat(fresh), max) : list
}

export class HttpError extends Error {
  constructor(public status: number) { super(`HTTP ${status}`) }
}

// GET some json; a hung connection or a hiccup of the Box gets a second and third chance
export async function getJson<T>(url: string, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal })
      if (!res.ok) throw new HttpError(res.status)
      return await res.json()
    } catch (e) {
      const final = e instanceof HttpError && e.status < 500   // 404: the session is gone, asking again will not help
      if (final || attempt >= retries) throw e instanceof DOMException && e.name === 'AbortError' ? new Error('The Box did not answer in time') : e
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
}

export const fetchOverview = () => getJson<Overview>('api/overview')

// polls data.html, every answer carries the next token. timestamps get shifted by the server/browser clock difference
export function useDashboard(overview: Overview, mock?: () => LiveResponse) {
  const [state, setState] = useState<LiveState>({
    connected: false,
    expired: false,
    lastUpdate: null,
    gen: [],
    mon: {},
    acc: null,
    logs: [],
    levels: {},
    transport: overview.transport,
    ooBw: null,
    ooWeights: null,
  })
  const token = useRef(overview.token)
  const pendingLevels = useRef<Record<string, boolean>>({})
  const kick = useRef<() => void>(() => {})

  const setLevel = useCallback((level: string, on: boolean) => {
    pendingLevels.current[level] = on
    setState((s) => ({ ...s, levels: { ...s.levels, [level]: on } }))
    kick.current()   // do not make the switch wait for the next round
  }, [])

  const clearLogs = useCallback(() => setState((s) => ({ ...s, logs: [] })), [])

  useEffect(() => {
    let stop = false
    let busy = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let ctrl: AbortController | undefined
    // the clock difference is measured once: the Box only knows full seconds, measuring again would make the samples jitter
    let shift: number | null = null
    let logId = 0

    const apply = (d: LiveResponse) => {
      if (shift === null) shift = d.tick ? Date.now() - d.tick : 0
      const dt = shift
      setState((s) => {
        let mon = s.mon
        for (const [k, v] of Object.entries(d.mon ?? {})) {
          const next = appendNewer(mon[k] ?? [], v, dt, LIMITS.mon)
          if (next !== mon[k]) mon = { ...mon, [k]: next }
        }
        const logs = d.msg?.length
          ? tail(s.logs.concat(d.msg.map((e) => ({ ...e, s: e.s + dt, m: decodeEntities(e.m), id: ++logId }))), LIMITS.logs)
          : s.logs
        return {
          ...s,
          connected: true,
          lastUpdate: Date.now(),
          gen: appendNewer(s.gen, d.gen, dt, LIMITS.gen),
          mon,
          logs,
          acc: d.acc ?? s.acc,
          // a switch flipped while this answer was on its way wins over what the Box says
          levels: d.msg_status ? { ...d.msg_status, ...pendingLevels.current } : s.levels,
          transport: d.transport ?? s.transport,
          ooBw: d.oo_bw ?? s.ooBw,
          ooWeights: d.oo_weights ?? s.ooWeights,
        }
      })
    }

    const schedule = (ms: number) => {
      clearTimeout(timer)
      if (!stop) timer = setTimeout(poll, ms)
    }

    const poll = async () => {
      if (stop || busy) return
      busy = true
      let next = document.hidden ? HIDDEN_MS : POLL_MS
      let sent: Record<string, boolean> | null = null
      try {
        let data: LiveResponse
        if (mock) {
          data = mock()
        } else {
          const body = new URLSearchParams({ token: token.current })
          if (Object.keys(pendingLevels.current).length) {
            sent = pendingLevels.current
            pendingLevels.current = {}
            body.set('runlevel', JSON.stringify(sent))
          }
          ctrl = new AbortController()
          const abort = setTimeout(() => ctrl?.abort(), TIMEOUT_MS)
          let res: Response
          try {
            res = await fetch('data.html', { method: 'POST', body, signal: ctrl.signal, credentials: 'same-origin' })
          } finally {
            clearTimeout(abort)
          }
          // 404: the session is gone (timed out, or the Box was restarted). 503: it is not a dashboard session (any more).
          if (res.status === 404 || res.status === 503) {
            stop = true
            setState((s) => ({ ...s, expired: true, connected: false }))
            return
          }
          if (!res.ok) throw new HttpError(res.status)
          data = await res.json()
          if (data.token) token.current = data.token
        }
        failures = 0
        if (!stop) apply(data)
      } catch {
        if (stop) return
        // not delivered: try these again
        if (sent) pendingLevels.current = { ...sent, ...pendingLevels.current }
        failures += 1
        // one lost answer is no reason to alarm anybody
        if (failures > 1) setState((s) => (s.connected ? { ...s, connected: false } : s))
        next = Math.min(15_000, 1000 * 2 ** Math.min(failures - 1, 4))
      } finally {
        busy = false
      }
      schedule(next)
    }

    kick.current = () => { if (!busy) schedule(0) }
    const wake = () => { if (!document.hidden) kick.current() }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    poll()

    return () => {
      stop = true
      kick.current = () => {}
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      ctrl?.abort()
      clearTimeout(timer)
    }
  }, [mock])

  return useMemo(() => ({ ...state, setLevel, clearLogs }), [state, setLevel, clearLogs])
}

// bridge info & health checks: slow data, once a minute
export function useHealth(mock?: HealthResponse): HealthResponse | null {
  const [data, setData] = useState<HealthResponse | null>(mock ?? null)

  useEffect(() => {
    if (mock) return
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const data = await getJson<HealthResponse>('api/health', 0)
        if (!stop) setData(data)
      } catch { /* keep what we have, try again next round */ }
      if (!stop) timer = setTimeout(load, 60_000)
    }
    load()
    return () => { stop = true; if (timer) clearTimeout(timer) }
  }, [mock])

  return data
}
