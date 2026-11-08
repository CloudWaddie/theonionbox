import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccStats, GenSample, History, LiveResponse, LogEvent, MonSample, Overview } from './types'
import { decodeEntities } from './format'

export interface LiveState {
  connected: boolean
  expired: boolean
  gen: GenSample[]
  mon: Record<string, MonSample[]>
  acc: { enabled: boolean; stats?: AccStats } | null
  logs: LogEvent[]
  levels: Record<string, boolean>
  transport: { or: number; circ: number; stream: number }
  ooBw: { read: History | null; write: History | null } | null
  ooWeights: NonNullable<LiveResponse['oo_weights']> | null
}

const POLL_MS = 2000
const LIMITS = { gen: 900, mon: 1500, logs: 400 }

function append<T>(list: T[], extra: T[] | undefined, max: number): T[] {
  if (!extra || extra.length === 0) return list
  const merged = list.concat(extra)
  return merged.length > max ? merged.slice(merged.length - max) : merged
}

export async function fetchOverview(): Promise<Overview> {
  const res = await fetch('api/overview', { cache: 'no-store', credentials: 'same-origin' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// polls data.html, every answer carries the next token. timestamps get shifted by the server/browser clock difference
export function useDashboard(overview: Overview, mock?: () => LiveResponse) {
  const [state, setState] = useState<LiveState>({
    connected: false,
    expired: false,
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

  const setLevel = useCallback((level: string, on: boolean) => {
    pendingLevels.current[level] = on
    setState((s) => ({ ...s, levels: { ...s.levels, [level]: on } }))
  }, [])

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ctrl = new AbortController()

    const apply = (d: LiveResponse) => {
      const shift = d.tick ? Date.now() - d.tick : 0
      setState((s) => {
        const mon = { ...s.mon }
        for (const [k, v] of Object.entries(d.mon ?? {})) {
          mon[k] = append(mon[k] ?? [], v.map((p) => ({ ...p, s: p.s + shift })), LIMITS.mon)
        }
        const logs = append(
          s.logs,
          d.msg?.map((e) => ({ ...e, s: e.s + shift, m: decodeEntities(e.m) })),
          LIMITS.logs,
        )
        return {
          ...s,
          connected: true,
          gen: append(s.gen, d.gen?.map((p) => ({ ...p, s: p.s + shift })), LIMITS.gen),
          mon,
          logs,
          acc: d.acc ?? s.acc,
          levels: d.msg_status ?? s.levels,
          transport: d.transport ?? s.transport,
          ooBw: d.oo_bw ?? s.ooBw,
          ooWeights: d.oo_weights ?? s.ooWeights,
        }
      })
    }

    const poll = async () => {
      if (stop) return
      try {
        let data: LiveResponse
        if (mock) {
          data = mock()
        } else {
          const body = new URLSearchParams({ token: token.current })
          if (Object.keys(pendingLevels.current).length) {
            body.set('runlevel', JSON.stringify(pendingLevels.current))
            pendingLevels.current = {}
          }
          const res = await fetch('data.html', {
            method: 'POST',
            body,
            signal: ctrl.signal,
            credentials: 'same-origin',
          })
          if (res.status === 404 || res.status === 503 || res.status === 500) {
            setState((s) => ({ ...s, expired: true, connected: false }))
            return
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          data = await res.json()
          if (data.token) token.current = data.token
        }
        if (!stop) apply(data)
      } catch (err) {
        if (stop) return
        setState((s) => ({ ...s, connected: false }))
      }
      if (!stop) timer = setTimeout(poll, POLL_MS)
    }
    poll()

    return () => {
      stop = true
      ctrl.abort()
      if (timer) clearTimeout(timer)
    }
  }, [mock])

  return { ...state, setLevel }
}
