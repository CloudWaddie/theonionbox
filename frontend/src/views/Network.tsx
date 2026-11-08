import { useMemo, useState } from 'react'
import type { History, NetworkInfo } from '@/lib/types'
import type { LiveState } from '@/lib/useDashboard'
import { formatDateTime, formatRate } from '@/lib/format'
import { Legend, TimeChart, type ChartSeries } from '@/components/charts'
import { Badge } from '@/components/ui/badge'
import { Empty, KeyValues, Panel, Stat } from '@/components/common'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const PERIODS: [string, string][] = [['d3', '3 days'], ['w1', '1 week'], ['m1', '1 month'], ['m3', '3 months'], ['m6', '6 months'], ['y1', '1 year'], ['y5', '5 years']]

function rowsOf(h: History | null | undefined, period: string, abs = false) {
  return (h?.[period] ?? []).map(([t, v]) => ({ t, v: v == null ? null : abs ? Math.abs(v) : v }))
}

// merge [t, value] series by timestamp
function join(period: string, parts: Record<string, { h: History | null | undefined; scale?: number; abs?: boolean }>) {
  const byTime = new Map<number, Record<string, number | null> & { t: number }>()
  for (const [key, { h, scale = 1, abs }] of Object.entries(parts)) {
    for (const { t, v } of rowsOf(h, period, abs)) {
      const row = byTime.get(t) ?? ({ t } as Record<string, number | null> & { t: number })
      row[key] = v == null ? null : v * scale
      byTime.set(t, row)
    }
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t)
}

function PeriodTabs({ available, value, onChange }: { available: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList className="h-8">
        {PERIODS.filter(([k]) => available.includes(k)).map(([k, label]) => (
          <TabsTrigger key={k} value={k} className="px-2.5 text-xs">{label}</TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

export function NetworkView({ network, live }: { network: NetworkInfo | null; live: LiveState }) {
  return (
    <div className="space-y-6">
      {network && <Details network={network} />}
      {live.ooBw && <BandwidthHistory bw={live.ooBw} />}
      {live.ooWeights && <Weights w={live.ooWeights} />}
      {!network && !live.ooBw && !live.ooWeights && <Empty>No network status available from Onionoo yet.</Empty>}
    </div>
  )
}

function Details({ network: n }: { network: NetworkInfo }) {
  const loc = n.location
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Network status" description={<>Published {formatDateTime(n.published)} by <a className="underline underline-offset-4" href="https://metrics.torproject.org/rs.html" target="_blank" rel="noreferrer">Onionoo</a></>} action={<Badge variant={n.running ? 'success' : 'destructive'}>{n.running ? 'Running' : 'Offline'}</Badge>}>
        <KeyValues rows={[
          ['Type', n.type],
          ['Nickname', n.nickname],
          ['Fingerprint', <span className="font-mono text-xs">{n.fingerprint}</span>],
          ['Platform', n.platform],
          ['Contact', n.contact],
          ['OR addresses', n.or_addresses.join(' · ')],
          ['Exit addresses', n.exit_addresses.join(' · ')],
          ['DIR address', n.dir_address],
          ['First seen', formatDateTime(n.first_seen)],
          ['Last seen', formatDateTime(n.last_seen)],
          ['Last restart', n.last_restarted ? formatDateTime(n.last_restarted) : null],
          ['Address changed', n.last_changed ? formatDateTime(n.last_changed) : null],
          ['Hibernating', n.hibernating ? 'yes' : null],
          ['Flags', n.flags.length ? <div className="flex flex-wrap gap-1.5">{n.flags.map((f) => <Badge key={f} variant="secondary">{f}</Badge>)}</div> : null],
        ]} />
      </Panel>
      <Panel title="Location" description="Based on the node's first OR address">
        <KeyValues rows={[
          ['Country', [loc.country_name, loc.country && `(${String(loc.country).toUpperCase()})`].filter(Boolean).join(' ')],
          ['Region', loc.region as string],
          ['City', loc.city as string],
          ['Coordinates', loc.latitude != null && loc.longitude != null ? `${loc.latitude}, ${loc.longitude}` : null],
          ['AS', n.as_number ? `${n.as_number}${n.as_name ? ` · ${n.as_name}` : ''}` : null],
          ['Host name', n.host_name],
        ]} />
      </Panel>
    </div>
  )
}

const READ: ChartSeries = { key: 'down', label: 'Read', color: 'hsl(var(--chart-2))' }
const WRITE: ChartSeries = { key: 'up', label: 'Written', color: 'hsl(var(--chart-1))' }

function BandwidthHistory({ bw }: { bw: NonNullable<LiveState['ooBw']> }) {
  const available = Object.keys({ ...bw.read, ...bw.write })
  const [period, setPeriod] = useState(available.includes('w1') ? 'w1' : available[0] ?? 'w1')
  const rows = useMemo(() => join(period, { down: { h: bw.read, abs: true }, up: { h: bw.write } }), [bw, period])
  return (
    <Panel title="Bandwidth history" description="Long term traffic as published by the Tor network." action={<PeriodTabs available={available} value={period} onChange={setPeriod} />}>
      {rows.length < 2 ? <Empty>No data for this period.</Empty> : (
        <div className="space-y-3"><Legend series={[WRITE, READ]} /><TimeChart data={rows} series={[WRITE, READ]} format={formatRate} minTop={10_000} height={260} /></div>
      )}
    </Panel>
  )
}

const pct = (v: number) => `${(v * 100).toFixed(v < 0.001 ? 4 : 3)}%`

function Weights({ w }: { w: NonNullable<LiveState['ooWeights']> }) {
  const available = Object.keys({ ...w.cwf, ...w.cw })
  const [period, setPeriod] = useState(available.includes('m1') ? 'm1' : available[0] ?? 'm1')
  const probs = useMemo(() => join(period, { gp: { h: w.gp }, mp: { h: w.mp }, ep: { h: w.ep }, cwf: { h: w.cwf } }), [w, period])
  const cw = useMemo(() => join(period, { cw: { h: w.cw } }), [w, period])
  const d = w.data
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Consensus weight" value={d.cw != null ? d.cw.toLocaleString() : '–'} hint="relative bandwidth weight" />
        <Stat label="Guard probability" value={d.gp != null ? pct(d.gp) : '–'} />
        <Stat label="Middle probability" value={d.mp != null ? pct(d.mp) : '–'} />
        <Stat label="Exit probability" value={d.ep != null ? pct(d.ep) : '–'} />
      </div>
      <Panel title="Path selection" description="Probability that clients pick this node, and its share of the consensus." action={<PeriodTabs available={available} value={period} onChange={setPeriod} />}>
        {probs.length < 2 ? <Empty>No data for this period.</Empty> : (
          <div className="space-y-3">
            <Legend series={PROBS} />
            <TimeChart data={probs} series={PROBS} format={pct} height={240} />
          </div>
        )}
      </Panel>
      {cw.length > 1 && (
        <Panel title="Consensus weight">
          <TimeChart data={cw} series={[{ key: 'cw', label: 'Consensus weight', color: 'hsl(var(--chart-3))' }]} format={(v) => String(Math.round(v))} height={200} />
        </Panel>
      )}
    </>
  )
}

const PROBS: ChartSeries[] = [
  { key: 'gp', label: 'Guard', color: 'hsl(var(--chart-1))' },
  { key: 'mp', label: 'Middle', color: 'hsl(var(--chart-4))' },
  { key: 'ep', label: 'Exit', color: 'hsl(var(--chart-2))' },
  { key: 'cwf', label: 'Consensus fraction', color: 'hsl(var(--chart-3))' },
]
