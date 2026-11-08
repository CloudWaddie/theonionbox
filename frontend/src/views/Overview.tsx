import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Cpu, MemoryStick, Network, Waypoints } from 'lucide-react'
import type { LiveState } from '@/lib/useDashboard'
import type { Overview as OverviewData } from '@/lib/types'
import { formatBytes, formatPercent, formatRate } from '@/lib/format'
import { Legend, TimeChart, type ChartSeries } from '@/components/charts'
import { Empty, KeyValues, Panel, Stat } from '@/components/common'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const UP: ChartSeries = { key: 'up', label: 'Upload', color: 'hsl(var(--chart-1))' }
const DOWN: ChartSeries = { key: 'down', label: 'Download', color: 'hsl(var(--chart-2))' }

const INTERVAL_LABEL: Record<string, string> = {
  '1s': 'Live',
  '1m': '1 min',
  '5m': '5 min',
  '1h': '1 hour',
  '4h': '4 hours',
  Ch: '12 hours',
}

export function OverviewView({ overview, live }: { overview: OverviewData; live: LiveState }) {
  const intervals = Object.keys(overview.intervals)
  const [interval, setInterval] = useState('1s')

  const rows = useMemo(() => {
    const secs = overview.intervals[interval] || 1
    const samples = live.mon[interval] ?? []
    const shown = interval === '1s' ? samples.slice(-180) : samples
    return shown.map((p) => ({ t: p.s, up: Math.abs(p.w) / secs, down: Math.abs(p.r) / secs }))
  }, [live.mon, interval, overview.intervals])

  const now = (live.mon['1s'] ?? []).slice(-1)[0]
  const last = live.gen.slice(-1)[0]
  const cpuRows = useMemo(() => live.gen.map((p) => ({ t: p.s, cpu: p.c, mem: p.mp })), [live.gen])
  const tempRows = useMemo(() => live.gen.filter((p) => p.t != null).map((p) => ({ t: p.s, temp: p.t as number })), [live.gen])
  const host = overview.host
  const cores = host ? Array.from({ length: host.cpu_count }, (_, i) => last?.[`c${i}`] as number | undefined) : []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Upload" icon={<ArrowUp />} value={formatRate(now ? Math.abs(now.w) : null)} hint={now?.tw != null ? `${formatBytes(now.tw)} total` : undefined} />
        <Stat label="Download" icon={<ArrowDown />} value={formatRate(now ? Math.abs(now.r) : null)} hint={now?.tr != null ? `${formatBytes(now.tr)} total` : undefined} />
        <Stat label="Circuits" icon={<Waypoints />} value={live.transport.circ} hint={`${live.transport.stream} streams`} />
        <Stat label="OR connections" icon={<Network />} value={live.transport.or} hint="to other relays" />
      </div>

      <Panel
        title="Bandwidth"
        description="Traffic of this Tor node, as reported by its control port."
        action={
          <Tabs value={interval} onValueChange={setInterval}>
            <TabsList className="h-8">
              {intervals.map((k) => (
                <TabsTrigger key={k} value={k} className="px-2.5 text-xs">
                  {INTERVAL_LABEL[k] ?? k}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      >
        {rows.length < 2 ? (
          <Empty>Collecting data…</Empty>
        ) : (
          <div className="space-y-3">
            <Legend series={[UP, DOWN]} />
            <TimeChart data={rows} series={[UP, DOWN]} format={formatRate} minTop={10_000} height={260} step={interval !== '1s'} />
          </div>
        )}
      </Panel>

      {host && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="CPU" description={`${host.cpu_count} cores · ${host.system ?? ''}`} action={<span className="font-mono text-sm tabular-nums"><Cpu className="mr-1.5 inline size-4 text-muted-foreground" />{formatPercent(last?.c)}</span>}>
            {cpuRows.length < 2 ? <Empty>Collecting data…</Empty> : (
              <>
                <TimeChart data={cpuRows} series={[{ key: 'cpu', label: 'CPU', color: 'hsl(var(--chart-3))' }]} format={(v) => `${Math.round(v)}%`} yMax={100} height={180} />
                {host.cpu_count > 1 && (
                  <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                    {cores.map((c, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground"><span>Core {i}</span><span className="font-mono tabular-nums">{formatPercent(c)}</span></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-chart-3 transition-all" style={{ width: `${Math.min(100, c ?? 0)}%` }} /></div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Panel>
          <Panel title="Memory" description={host.memory_mb ? `${formatBytes(host.memory_mb * 1e6)} installed` : undefined} action={<span className="font-mono text-sm tabular-nums"><MemoryStick className="mr-1.5 inline size-4 text-muted-foreground" />{formatPercent(last?.mp)}</span>}>
            {cpuRows.length < 2 ? <Empty>Collecting data…</Empty> : <TimeChart data={cpuRows} series={[{ key: 'mem', label: 'Memory', color: 'hsl(var(--chart-4))' }]} format={(v) => `${Math.round(v)}%`} yMax={100} height={180} />}
            {tempRows.length > 1 && (
              <div className="mt-4">
                <div className="mb-1 text-xs text-muted-foreground">Temperature</div>
                <TimeChart data={tempRows} series={[{ key: 'temp', label: 'Temperature', color: 'hsl(var(--destructive))' }]} format={(v) => `${Math.round(v)}°C`} height={100} />
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

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{formatBytes(value)} / {formatBytes(max)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function Accounting({ stats }: { stats: NonNullable<LiveState['acc']>['stats'] & object }) {
  const hours = Math.floor(stats.time_until_reset / 3600)
  const mins = Math.floor((stats.time_until_reset % 3600) / 60)
  return (
    <Panel title="Accounting" description={`Status: ${stats.status} · resets in ${hours}h ${mins}m (${new Date(stats.interval_end * 1000).toLocaleString()})`}>
      <div className="grid gap-6 sm:grid-cols-2">
        <Meter label="Downloaded" value={stats.read_bytes} max={stats.read_limit} />
        <Meter label="Uploaded" value={stats.written_bytes} max={stats.write_limit} />
      </div>
    </Panel>
  )
}
