import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { axisTime } from '@/lib/format'

// Hand-rolled SVG charts. A charting library was most of the page's weight and re-rendered slowly on every poll;
// all the dashboard needs is an area chart over time and a sparkline.

export interface ChartSeries {
  key: string
  label: string
  // css colour, hsl(var(--chart-n)) so it follows the theme
  color: string
}

export type Row = { t: number } & Record<string, number | null | undefined>

interface TimeChartProps {
  data: Row[]
  series: ChartSeries[]
  height?: number
  format?: (v: number) => string
  // fixed y max, e.g. 100 for percent
  yMax?: number
  // keeps an idle chart from zooming into noise
  minTop?: number
  step?: boolean
}

const PAD = { top: 8, right: 8, bottom: 26, left: 64 }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

// next "round" number above v, so that four grid lines land on readable values
function niceTop(v: number): number {
  if (!(v > 0) || !isFinite(v)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10) * p
}

// more samples than pixels are wasted work: keep the peak of each bucket
function thin(data: Row[], keys: string[], buckets: number): Row[] {
  if (buckets < 1 || data.length <= buckets * 1.5) return data
  const size = data.length / buckets
  const out: Row[] = []
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size)
    const to = Math.min(data.length, Math.floor((b + 1) * size))
    if (to <= from) continue
    const row: Row = { t: data[to - 1].t }
    for (const k of keys) {
      let max: number | null = null
      for (let i = from; i < to; i++) {
        const v = data[i][k]
        if (v != null && isFinite(v) && (max === null || v > max)) max = v
      }
      row[k] = max
    }
    out.push(row)
  }
  return out
}

function nearest(rows: Row[], t: number): number {
  let lo = 0, hi = rows.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (rows[mid].t < t) lo = mid; else hi = mid
  }
  return t - rows[lo].t <= rows[hi].t - t ? lo : hi
}

export const TimeChart = memo(function TimeChart({ data, series, height = 220, format = String, yMax, minTop = 0, step }: TimeChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = Math.max(0, height - PAD.top - PAD.bottom)

  const model = useMemo(() => {
    if (plotW < 20 || data.length < 2) return null
    const keys = series.map((s) => s.key)
    const rows = thin(data, keys, Math.floor(plotW / 2))
    const t0 = rows[0].t
    const span = rows[rows.length - 1].t - t0 || 1
    let max = 0
    for (const r of rows) for (const k of keys) { const v = r[k]; if (v != null && v > max) max = v }
    const top = yMax ?? niceTop(Math.max(max, minTop))
    const x = (t: number) => PAD.left + ((t - t0) / span) * plotW
    const y = (v: number) => PAD.top + plotH - (Math.min(v, top) / top) * plotH
    const base = PAD.top + plotH

    const paths = series.map((s) => {
      let line = ''
      let firstX = 0, lastX = 0, prevY = 0
      for (const r of rows) {
        const v = r[s.key]
        if (v == null || !isFinite(v)) continue   // gaps are bridged
        const px = +x(r.t).toFixed(1), py = +y(v).toFixed(1)
        if (!line) { line = `M${px},${py}`; firstX = px }
        else line += step ? `H${px}V${py}` : py === prevY ? `H${px}` : `L${px},${py}`
        lastX = px; prevY = py
      }
      return { ...s, line, area: line ? `${line}L${lastX},${base}L${firstX},${base}Z` : '' }
    })

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: top * f, py: y(top * f) }))
    const count = Math.max(2, Math.min(8, Math.floor(plotW / 110)))
    const label = axisTime(span)
    const xTicks = Array.from({ length: count }, (_, i) => {
      const t = t0 + (span * (i + 0.5)) / count
      return { px: x(t), text: label(t) }
    })
    return { rows, x, y, paths, yTicks, xTicks, base }
  }, [data, series, plotW, plotH, yMax, minTop, step])

  const at = model && hover != null ? model.rows[Math.min(hover, model.rows.length - 1)] : null
  const atX = at && model ? model.x(at.t) : 0

  return (
    <div ref={ref} style={{ height }} className="relative w-full select-none">
      {model && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Chart: ${series.map((s) => s.label).join(', ')}`}
          className="block touch-pan-y"
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            const px = e.clientX - box.left
            if (px < PAD.left - 4 || px > width - PAD.right + 4) return setHover(null)
            const rows = model.rows
            const t = rows[0].t + ((px - PAD.left) / plotW) * (rows[rows.length - 1].t - rows[0].t)
            setHover(nearest(rows, t))
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            {model.paths.map((p) => (
              <linearGradient key={p.key} id={`g${uid}${p.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={p.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={p.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {model.yTicks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={width - PAD.right} y1={t.py} y2={t.py} stroke="hsl(var(--border))" strokeDasharray={i === 0 ? undefined : '3 3'} />
              <text x={PAD.left - 8} y={t.py} dy="0.32em" textAnchor="end" fontSize={11} fill="hsl(var(--muted-foreground))" className="tabular-nums">{format(t.v)}</text>
            </g>
          ))}
          {model.xTicks.map((t, i) => (
            <text key={i} x={t.px} y={height - 6} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))" className="tabular-nums">{t.text}</text>
          ))}
          {model.paths.map((p) => p.line && (
            <g key={p.key}>
              <path d={p.area} fill={`url(#g${uid}${p.key})`} />
              <path d={p.line} fill="none" stroke={p.color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {at && (
            <g pointerEvents="none">
              <line x1={atX} x2={atX} y1={PAD.top} y2={model.base} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
              {series.map((s) => {
                const v = at[s.key]
                return v == null ? null : <circle key={s.key} cx={atX} cy={model.y(v)} r={3.5} fill={s.color} stroke="hsl(var(--card))" strokeWidth={1.5} />
              })}
            </g>
          )}
        </svg>
      )}
      {at && (
        <div
          className="pointer-events-none absolute top-2 z-10 whitespace-nowrap rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
          style={atX > width / 2 ? { right: width - atX + 12 } : { left: atX + 12 }}
        >
          <div className="mb-1 font-medium text-muted-foreground">{new Date(at.t).toLocaleString()}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
              <span className="font-mono tabular-nums">{at[s.key] == null ? '–' : format(at[s.key] as number)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export function Legend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

/** Tiny chart without axes: one polyline per series, stretched to its box. */
export const Sparkline = memo(function Sparkline({ lines, minTop = 0, className = 'h-14' }: {
  lines: { values: number[]; color: string }[]
  minTop?: number
  className?: string
}) {
  const W = 100, H = 30
  const n = Math.max(0, ...lines.map((l) => l.values.length))
  if (n < 2) return <div className={`${className} rounded-md bg-muted/50`} />
  let top = minTop
  for (const l of lines) for (const v of l.values) if (v > top) top = v
  top = top || 1
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`${className} block w-full`} aria-hidden>
      {lines.map((l, i) => {
        if (l.values.length < 2) return null
        const dx = W / (l.values.length - 1)
        const pts = l.values.map((v, j) => `${(j * dx).toFixed(2)},${(H - 1 - (Math.min(v, top) / top) * (H - 2)).toFixed(2)}`).join(' ')
        return (
          <g key={i}>
            <polygon points={`0,${H} ${pts} ${W},${H}`} fill={l.color} fillOpacity={0.12} />
            <polyline points={pts} fill="none" stroke={l.color} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
        )
      })}
    </svg>
  )
})
