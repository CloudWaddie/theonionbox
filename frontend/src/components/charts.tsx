import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisTime } from '@/lib/format'

export interface ChartSeries {
  key: string
  label: string
  /** CSS colour, usually `hsl(var(--chart-1))` so that it follows the theme. */
  color: string
}

type Row = { t: number } & Record<string, number | null | undefined>

interface TimeChartProps {
  data: Row[]
  series: ChartSeries[]
  height?: number
  format?: (v: number) => string
  /** Fix the upper bound of the y axis, e.g. 100 for percentages. */
  yMax?: number
  /** Smallest upper bound of an auto-scaled y axis, so that an idle chart does not zoom into noise. */
  minTop?: number
  step?: boolean
  stacked?: boolean
}

function ChartTooltip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-muted-foreground">{new Date(label).toLocaleString()}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-mono tabular-nums">{p.value == null ? '–' : format(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function TimeChart({ data, series, height = 220, format = (v) => String(v), yMax, minTop = 0, step, stacked }: TimeChartProps) {
  const span = data.length > 1 ? data[data.length - 1].t - data[0].t : 0
  const id = (k: string) => `grad-${k}-${series.map((s) => s.key).join('')}`

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={id(s.key)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={axisTime(span)}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            height={30}
            minTickGap={48}
          />
          <YAxis
            width={64}
            tickFormatter={format}
            domain={[0, yMax ?? ((max: number) => Math.max(max, minTop))]}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals
          />
          <Tooltip content={<ChartTooltip format={format} />} cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: 3 }} />
          {series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.label}
              type={step ? 'stepAfter' : 'monotone'}
              stroke={s.color}
              strokeWidth={1.75}
              fill={`url(#${id(s.key)})`}
              stackId={stacked ? 'a' : undefined}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Legend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}
