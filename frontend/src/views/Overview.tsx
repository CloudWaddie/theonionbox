import { memo, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Cpu, MemoryStick, Network, Waypoints } from 'lucide-react'
import type { LiveState } from '@/lib/useDashboard'
import type { AccStats, HealthInfo, Overview as OverviewData } from '@/lib/types'
import { formatBytes, formatDuration, formatPercent, formatRate } from '@/lib/format'
import { Legend, Sparkline, TimeChart, type ChartSeries } from '@/components/charts'
import { Empty, KeyValues, Meter, Panel, Stat } from '@/components/common'
import { HealthPanel } from '@/views/Health'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const UP: ChartSeries = { key: 'up', label: 'Upload', color: 'hsl(var(--chart-1))' }
const DOWN: ChartSeries = { key: 'down', label: 'Download', color: 'hsl(var(--chart-2))' }
const BW = [UP, DOWN]
const CPU = [{ key: 'cpu', label: 'CPU', color: 'hsl(var(--chart-3))' }]
const MEM = [{ key: 'mem', label: 'Memory', color: 'hsl(var(--chart-4))' }]
const TEMP = [{ key: 'temp', label: 'Temperature', color: 'hsl(var(--destructive))' }]
const percent = (v: number) => `${Math.round(v)}%`
const degrees = (v: number) => `${Math.round(v)}°C`

const INTERVAL_LABEL: Record<string, string> = {
  '1s': 'Live',
  '1m': '1 min',
  '5m': '5 min',
  '1h': '1 hour',
  '4h': '4 hours',
  Ch: '12 hours',
}

const HealthMemo = memo(HealthPanel)

export function OverviewView({ overview, live, health }: { overview: OverviewData; live: LiveState; health: HealthInfo | null }) {
  const intervals = Object.keys(overview.intervals)
  const [interval, setInterval] = useState(() => (intervals.includes('1s') ? '1s' : intervals[0] ?? '1s'))

  const samples = live.mon[interval]
  const { rows, summary } = useMemo(() => {
    const secs = overview.intervals[interval] || 1
    const all = samples ?? []
    const shown = interval === '1s' ? all.slice(-180) : all
    let up = 0, down = 0, peakUp = 0, peakDown = 0
    const rows = shown.map((p) => {
      const w = Math.abs(p.w), r = Math.abs(p.r)
      up += w; down += r
      if (w > peakUp) peakUp = w
      if (r > peakDown) peakDown = r
      return { t: p.s, up: w / secs, down: r / secs }
    })
    const span = rows.length * secs
    return { rows, summary: rows.length ? { up, down, avgUp: up / span, avgDown: down / span, peakUp: peakUp / secs, peakDown: peakDown / secs, span } : null }
  }, [samples, interval, overview.intervals])

  const live1s = live.mon['1s']
  const now = live1s?.[live1s.length - 1]
  const spark = useMemo(() => {
    const recent = (live1s ?? []).slice(-60)
    return { up: recent.map((p) => Math.abs(p.w)), down: recent.map((p) => Math.abs(p.r)) }
  }, [live1s])

  const last = live.gen[live.gen.length - 1]
  const cpuRows = useMemo(() => live.gen.map((p) => ({ t: p.s, cpu: p.c, mem: p.mp })), [live.gen])
  const tempRows = useMemo(() => live.gen.filter((p) => p.t != null).map((p) => ({ t: p.s, temp: p.t as number })), [live.gen])
  const host = overview.host
  const cores = host ? Array.from({ length: host.cpu_count }, (_, i) => last?.[`c${i}`] as number | undefined) : []
  const isRelay = overview.tor.mode !== 'Client'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Upload" icon={<ArrowUp />} value={formatRate(now ? Math.abs(now.w) : null)} hint={now?.tw != null ? `${formatBytes(now.tw)} total` : undefined}
          chart={<Sparkline className="h-8" minTop={5000} lines={[{ values: spark.up, color: UP.color }]} />} />
        <Stat label="Download" icon={<ArrowDown />} value={formatRate(now ? Math.abs(now.r) : null)} hint={now?.tr != null ? `${formatBytes(now.tr)} total` : undefined}
          chart={<Sparkline className="h-8" minTop={5000} lines={[{ values: spark.down, color: DOWN.color }]} />} />
        <Stat label="Circuits" icon={<Waypoints />} value={live.transport.circ.toLocaleString()} hint={`${live.transport.stream.toLocaleString()} streams`} />
        <Stat label="OR connections" icon={<Network />} value={live.transport.or.toLocaleString()} hint={isRelay ? 'to clients and other relays' : 'to the Tor network'} />
      </div>

      {health && <HealthMemo health={health} />}

      <Panel
        title="Bandwidth"
        description="Traffic of this Tor node, as reported by its control port."
        action={intervals.length > 1 && (
          <Tabs value={interval} onValueChange={setInterval}>
            <TabsList className="h-8">
              {intervals.map((k) => (
                <TabsTrigger key={k} value={k} className="px-2.5 text-xs">
                  {INTERVAL_LABEL[k] ?? k}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      >
        {rows.length < 2 ? (
          <Empty>{live.lastUpdate ? 'Collecting data…' : 'Waiting for the first data…'}</Empty>
        ) : (
          <div className="space-y-3">
            <Legend series={BW} />
            <TimeChart data={rows} series={BW} format={formatRate} minTop={10_000} height={260} step={interval !== '1s'} />
            {summary && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4 text-sm sm:grid-cols-4">
                <Fact label="Average" up={formatRate(summary.avgUp)} down={formatRate(summary.avgDown)} />
                <Fact label="Peak" up={formatRate(summary.peakUp)} down={formatRate(summary.peakDown)} />
                <Fact label="Transferred" up={formatBytes(summary.up)} down={formatBytes(summary.down)} />
                <div>
                  <dt className="text-xs text-muted-foreground">Shown</dt>
                  <dd className="mt-1 font-mono tabular-nums">{formatDuration(summary.span)}</dd>
                  <dd className="font-mono text-xs tabular-nums text-muted-foreground">{formatBytes(summary.up + summary.down)} in total</dd>
                </div>
              </dl>
            )}
          </div>
        )}
      </Panel>

      {host && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="CPU" description={[`${host.cpu_count} core${host.cpu_count === 1 ? '' : 's'}`, host.system].filter(Boolean).join(' · ')} action={<span className="font-mono text-sm tabular-nums"><Cpu className="mr-1.5 inline size-4 text-muted-foreground" />{formatPercent(last?.c)}</span>}>
            {cpuRows.length < 2 ? <Empty>Collecting data…</Empty> : (
              <>
                <TimeChart data={cpuRows} series={CPU} format={percent} yMax={100} height={180} />
                {host.cpu_count > 1 && (
                  <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                    {cores.map((c, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground"><span>Core {i}</span><span className="font-mono tabular-nums">{formatPercent(c)}</span></div>
                        <Meter value={c ?? 0} className="h-1.5" barClassName="bg-chart-3" />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Panel>
          <Panel
            title="Memory"
            description={host.memory_mb ? `${formatBytes(host.memory_mb * 1e6)} installed${last?.mp != null ? ` · ${formatBytes((host.memory_mb * 1e6 * last.mp) / 100)} in use` : ''}` : undefined}
            action={<span className="font-mono text-sm tabular-nums"><MemoryStick className="mr-1.5 inline size-4 text-muted-foreground" />{formatPercent(last?.mp)}</span>}
          >
            {cpuRows.length < 2 ? <Empty>Collecting data…</Empty> : <TimeChart data={cpuRows} series={MEM} format={percent} yMax={100} height={180} />}
            {tempRows.length > 1 && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Temperature</span><span className="font-mono tabular-nums">{degrees(tempRows[tempRows.length - 1].temp)}</span></div>
                <TimeChart data={tempRows} series={TEMP} format={degrees} height={100} />
              </div>
            )}
          </Panel>
        </div>
      )}

      {live.acc?.enabled && live.acc.stats && <Accounting stats={live.acc.stats} />}

      {host && (
        <Panel title="Host">
          <KeyValues rows={[['Name', host.name], ['Operating system', host.os], ['Version', host.os_version], ['Architecture', host.system], ['Up since', host.uptime]]} />
        </Panel>
      )}
    </div>
  )
}

function Fact({ label, up, down }: { label: string; up: string; down: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex items-center gap-1.5 font-mono tabular-nums"><ArrowUp className="size-3.5 text-chart-1" />{up}</dd>
      <dd className="flex items-center gap-1.5 font-mono tabular-nums"><ArrowDown className="size-3.5 text-chart-2" />{down}</dd>
    </div>
  )
}

function Quota({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="space-y-2">
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{formatBytes(value)} / {formatBytes(max)}{max > 0 && <span className="text-muted-foreground"> · {pct.toFixed(pct < 10 ? 1 : 0)}%</span>}</span>
      </div>
      <Meter value={value} max={max} barClassName={pct >= 90 ? 'bg-destructive' : pct >= 75 ? 'bg-warning' : 'bg-primary'} />
    </div>
  )
}

function Accounting({ stats }: { stats: AccStats }) {
  // count down from the end of the interval, not from a number that was true when the Box was asked
  const left = Math.max(0, stats.interval_end - Date.now() / 1000)
  return (
    <Panel title="Accounting" description={`Status: ${stats.status} · resets in ${formatDuration(left)} (${new Date(stats.interval_end * 1000).toLocaleString()})`}>
      <div className="grid gap-6 sm:grid-cols-2">
        <Quota label="Downloaded" value={stats.read_bytes} max={stats.read_limit} />
        <Quota label="Uploaded" value={stats.written_bytes} max={stats.write_limit} />
      </div>
    </Panel>
  )
}
