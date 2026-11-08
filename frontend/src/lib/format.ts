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

export function formatDateTime(ts: number | string | null | undefined): string {
  if (ts == null || ts === '') return '–'
  const d = new Date(typeof ts === 'number' && ts < 1e11 ? ts * 1000 : ts)
  return isNaN(d.getTime()) ? String(ts) : d.toLocaleString()
}

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
