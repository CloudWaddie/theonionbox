const UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB']

// si units like the old dashboard
export function formatBytes(value: number | null | undefined, digits = 1): string {
  if (value == null || !isFinite(value)) return '–'
  const abs = Math.abs(value)
  if (abs < 1000) return `${Math.round(value)} B`
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log10(abs) / 3))
  const n = value / Math.pow(1000, i)
  return `${n.toFixed(Math.abs(n) >= 100 ? 0 : digits)} ${UNITS[i]}`
}

export const formatRate = (value: number | null | undefined) =>
  value == null ? '–' : `${formatBytes(value)}/s`

export function formatPercent(value: number | null | undefined, digits = 0): string {
  return value == null || !isFinite(value) ? '–' : `${value.toFixed(digits)}%`
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// onionoo & tor hand out 'YYYY-MM-DD HH:MM:SS' in UTC; Date() would read that as local time (or not at all, in Safari)
const UTC_STAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/

export function parseTime(ts: number | string | null | undefined): Date | null {
  if (ts == null || ts === '') return null
  let d: Date
  if (typeof ts === 'number') d = new Date(ts < 1e11 ? ts * 1000 : ts)
  else {
    const m = UTC_STAMP.exec(ts.trim())
    d = new Date(m ? `${m[1]}T${m[2]}Z` : ts)
  }
  return isNaN(d.getTime()) ? null : d
}

export function formatDateTime(ts: number | string | null | undefined): string {
  if (ts == null || ts === '') return '–'
  return parseTime(ts)?.toLocaleString() ?? String(ts)
}

// 93784 -> '1d 2h', 3700 -> '1h 1m', 75 -> '1m 15s'
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return '–'
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

const AGO: [number, string][] = [[31557600, 'year'], [2629800, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']]

// '3 days ago' / 'in 2 hours'
export function relativeTime(ts: number | string | null | undefined, now = Date.now()): string | null {
  const d = parseTime(ts)
  if (!d) return null
  const diff = (now - d.getTime()) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return 'just now'
  for (const [secs, name] of AGO) {
    if (abs >= secs) {
      const n = Math.round(abs / secs)
      const text = `${n} ${name}${n === 1 ? '' : 's'}`
      return diff >= 0 ? `${text} ago` : `in ${text}`
    }
  }
  return diff >= 0 ? 'a minute ago' : 'in a minute'
}

export const formatNumber = (v: number | null | undefined) => (v == null || !isFinite(v) ? '–' : v.toLocaleString())

export function axisTime(spanMs: number) {
  return (ts: number) => {
    const d = new Date(ts)
    if (spanMs > 2 * 24 * 3600 * 1000) return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    if (spanMs > 6 * 3600 * 1000) return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    if (spanMs < 15 * 60 * 1000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
}

// log messages come html-escaped and react escapes again, decode first
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  const doc = new DOMParser().parseFromString(text, 'text/html')
  return doc.documentElement.textContent ?? text
}
