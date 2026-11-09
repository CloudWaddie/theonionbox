import { useMemo, useState } from 'react'
import type { History, NetworkInfo } from '@/lib/types'
import type { LiveState } from '@/lib/useDashboard'
import { formatDateTime, formatRate, relativeTime } from '@/lib/format'
import { Legend, TimeChart, type ChartSeries } from '@/components/charts'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Blur, CopyButton, Empty, KeyValues, Panel, Stat } from '@/components/common'
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

type OoBw = NonNullable<LiveState['ooBw']>
type OoWeights = NonNullable<LiveState['ooWeights']>

export function NetworkView({ network, ooBw, ooWeights }: { network: NetworkInfo | null; ooBw: OoBw | null; ooWeights: OoWeights | null }) {
  return (
    <div className="space-y-6">
      {network && <Details network={network} />}
      {ooBw && <BandwidthHistory bw={ooBw} />}
      {ooWeights && <Weights w={ooWeights} />}
      {!network && !ooBw && !ooWeights && <Empty>No network status available from Onionoo yet.</Empty>}
    </div>
  )
}

// a date, and how long ago that was
function when(ts: string | number | null | undefined): ReactNode {
  if (ts == null || ts === '') return null
  const rel = relativeTime(ts)
  return <>{formatDateTime(ts)}{rel && <span className="ml-2 font-normal text-muted-foreground">{rel}</span>}</>
}

const list = (items: string[] | undefined | null) => (items?.length ? items.join(' · ') : null)

function policy(p: NetworkInfo['exit_policy_summary']): ReactNode {
  if (!p) return null
  const accept = p.accept ?? [], reject = p.reject ?? []
  if (reject.includes('1-65535')) return 'Rejects all exit traffic'
  if (accept.length) return <span className="font-mono text-xs">accept {accept.join(', ')}</span>
  if (reject.length) return <span className="font-mono text-xs">reject {reject.join(', ')}</span>
  return null
}

function Details({ network: n }: { network: NetworkInfo }) {
  const loc = n.location
  const bridge = n.type === 'Bridge'
  const unreachable = n.unreachable_or_addresses ?? []
  const hasBw = [n.advertised_bandwidth, n.observed_bandwidth, n.bandwidth_rate, n.bandwidth_burst].some((v) => v != null)
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel
        className="lg:row-span-2"
        title="Network status"
        description={<>Published {formatDateTime(n.published)} by <a className="underline underline-offset-4" href="https://metrics.torproject.org/rs.html" target="_blank" rel="noreferrer">Onionoo</a></>}
        action={
          <div className="flex flex-wrap justify-end gap-1.5">
            {n.overload_since != null && <Badge variant="warning" title={`Overloaded since ${formatDateTime(n.overload_since)}`}>Overloaded</Badge>}
            {n.running != null && <Badge variant={n.running ? 'success' : 'destructive'}>{n.running ? 'Running' : 'Offline'}</Badge>}
          </div>
        }
      >
        <KeyValues rows={[
          ['Type', n.type],
          ['Nickname', n.nickname],
          ['Fingerprint', n.fingerprint ? <span className="flex items-start gap-1"><span className="break-all font-mono text-xs leading-6">{n.fingerprint}</span><CopyButton value={n.fingerprint} label="Copy fingerprint" /></span> : null],
          ['Platform', n.platform],
          ['Version', n.version_status ? <Badge variant={n.recommended_version === false ? 'destructive' : n.version_status === 'recommended' ? 'success' : 'secondary'}>{n.version_status}</Badge> : null],
          ['Contact', n.contact],
          ['OR addresses', n.or_addresses.length ? <Blur on={bridge}>{n.or_addresses.join(' · ')}</Blur> : null],
          ['Unreachable', unreachable.length ? <span className="text-destructive"><Blur on={bridge}>{unreachable.join(' · ')}</Blur></span> : null],
          ['Exit addresses', n.exit_addresses.length ? <Blur on={bridge}>{n.exit_addresses.join(' · ')}</Blur> : null],
          ['DIR address', n.dir_address ? <Blur on={bridge}>{n.dir_address}</Blur> : null],
          ['Transports', list(n.transports)],
          ['Exit policy', policy(n.exit_policy_summary)],
          ['Family', n.family_size ? `${n.family_size} other relay${n.family_size === 1 ? '' : 's'}` : null],
          ['First seen', when(n.first_seen)],
          ['Last seen', when(n.last_seen)],
          ['Last restart', when(n.last_restarted)],
          ['Address changed', when(n.last_changed)],
          ['Hibernating', n.hibernating ? 'yes' : null],
          ['Flags', n.flags.length ? <div className="flex flex-wrap gap-1.5">{n.flags.map((f) => <Badge key={f} variant="secondary">{f}</Badge>)}</div> : null],
        ]} />
      </Panel>
      {hasBw && (
        <Panel title="Bandwidth" description="What this node told the directory authorities it can do.">
          <KeyValues rows={[
            ['Advertised', n.advertised_bandwidth != null ? formatRate(n.advertised_bandwidth) : null],
            ['Observed', n.observed_bandwidth != null ? formatRate(n.observed_bandwidth) : null],
            ['Rate limit', n.bandwidth_rate != null ? formatRate(n.bandwidth_rate) : null],
            ['Burst limit', n.bandwidth_burst != null ? formatRate(n.bandwidth_burst) : null],
            ['Consensus weight', n.consensus_weight != null ? <>{n.consensus_weight.toLocaleString()}{n.measured != null && <span className="ml-2 font-normal text-muted-foreground">{n.measured ? 'measured by bandwidth authorities' : 'not measured yet'}</span>}</> : null],
          ]} />
        </Panel>
      )}
      <Panel title="Location" description="Based on the node's first OR address">
        <KeyValues empty="Unknown." rows={[
          ['Country', [loc.country_name, loc.country && `(${String(loc.country).toUpperCase()})`].filter(Boolean).join(' ')],
          ['Region', loc.region as string],
          ['City', loc.city as string],
          ['Coordinates', loc.latitude != null && loc.longitude != null ? `${loc.latitude}, ${loc.longitude}` : null],
          ['AS', n.as_number ? `${n.as_number}${n.as_name ? ` · ${n.as_name}` : ''}` : n.as_name],
          ['Host name', n.host_name],
        ]} />
      </Panel>
    </div>
  )
}

const READ: ChartSeries = { key: 'down', label: 'Read', color: 'hsl(var(--chart-2))' }
const WRITE: ChartSeries = { key: 'up', label: 'Written', color: 'hsl(var(--chart-1))' }

function BandwidthHistory({ bw }: { bw: OoBw }) {
  const available = Object.keys({ ...bw.read, ...bw.write })
  const [chosen, setPeriod] = useState('w1')
  const period = available.includes(chosen) ? chosen : available[0] ?? chosen
  const rows = useMemo(() => join(period, { down: { h: bw.read, abs: true }, up: { h: bw.write, abs: true } }), [bw, period])
  return (
    <Panel title="Bandwidth history" description="Long term traffic as published by the Tor network." action={<PeriodTabs available={available} value={period} onChange={setPeriod} />}>
      {rows.length < 2 ? <Empty>No data for this period.</Empty> : (
        <div className="space-y-3"><Legend series={HISTORY} /><TimeChart data={rows} series={HISTORY} format={formatRate} minTop={10_000} height={260} /></div>
      )}
    </Panel>
  )
}

const HISTORY = [WRITE, READ]
const CW = [{ key: 'cw', label: 'Consensus weight', color: 'hsl(var(--chart-3))' }]
const whole = (v: number) => Math.round(v).toLocaleString()
const pct = (v: number) => `${(v * 100).toFixed(v < 0.001 ? 4 : 3)}%`

function Weights({ w }: { w: OoWeights }) {
  const available = Object.keys({ ...w.cwf, ...w.cw })
  const [chosen, setPeriod] = useState('m1')
  const period = available.includes(chosen) ? chosen : available[0] ?? chosen
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
          <TimeChart data={cw} series={CW} format={whole} height={200} />
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
