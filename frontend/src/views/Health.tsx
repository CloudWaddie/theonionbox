import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import type { BridgeInfo, CheckStatus, HealthInfo } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Blur, CopyButton, Empty, KeyValues, Panel } from '@/components/common'

const ICON = {
  ok: <CheckCircle2 className="size-4 text-success" />,
  warn: <AlertTriangle className="size-4 text-warning" />,
  fail: <XCircle className="size-4 text-destructive" />,
}

const SUMMARY: Record<CheckStatus, ['success' | 'warning' | 'destructive', string]> = {
  ok: ['success', 'Healthy'],
  warn: ['warning', 'Needs attention'],
  fail: ['destructive', 'Problem'],
}

const ORDER: Record<CheckStatus, number> = { fail: 0, warn: 1, ok: 2 }

export function HealthPanel({ health }: { health: HealthInfo }) {
  const [variant, text] = SUMMARY[health.status] ?? SUMMARY.warn
  // what needs attention goes first
  const checks = [...health.checks].sort((a, b) => (ORDER[a.status] ?? 1) - (ORDER[b.status] ?? 1))
  const passed = checks.filter((c) => c.status === 'ok').length
  return (
    <Panel title="Health" description={`${passed} of ${checks.length} checks passed · repeated every minute.`} action={<Badge variant={variant}>{text}</Badge>}>
      <ul className="divide-y text-sm">
        {checks.map((c) => (
          <li key={c.id} className="grid grid-cols-[1.25rem_1fr] items-start gap-x-3 gap-y-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[1.25rem_12rem_1fr]">
            <span className="mt-0.5">{ICON[c.status] ?? ICON.warn}</span>
            <span className="font-medium">{c.label}</span>
            <span className="col-start-2 min-w-0 break-words text-muted-foreground sm:col-start-3">{c.detail}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

const regionNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }) } catch { return null }
})()

function countryName(code: string) {
  try { return regionNames?.of(code) ?? code } catch { return code }
}

export function BridgePanel({ bridge }: { bridge: BridgeInfo }) {
  const clients = bridge.clients
  const max = Math.max(1, ...(clients?.countries ?? []).map((c) => c.count))
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Bridge" description="How clients reach this bridge." action={bridge.reachable != null ? <Badge variant={bridge.reachable ? 'success' : 'destructive'}>{bridge.reachable ? 'Reachable' : 'Not reachable'}</Badge> : undefined}>
        <KeyValues rows={[
          ['ORPort', bridge.or_port],
          ['ExtORPort', bridge.ext_or_port],
          ['Transports', bridge.transports.length ? (
            <div className="space-y-1">
              {bridge.transports.map((t) => (
                <div key={t.name}><Badge variant="secondary" className="mr-2">{t.name}</Badge><Blur><span className="font-mono text-xs">{t.listen ?? 'default address'}</span></Blur></div>
              ))}
            </div>
          ) : 'none: this is a plain bridge'],
          ['Published as', bridge.published_transports.length ? bridge.published_transports.join(', ') : null],
          ['Distribution', bridge.distribution],
          ['Publishing', bridge.publish],
          ['Hashed fingerprint', bridge.hashed_fingerprint ? <span className="font-mono text-xs">{bridge.hashed_fingerprint}</span> : null],
          ['Bridge line', bridge.bridge_line ? <span className="flex items-start gap-1"><Blur className="block min-w-0 flex-1"><code className="block select-all break-all rounded bg-muted p-2 text-xs">{bridge.bridge_line}</code></Blur><CopyButton value={bridge.bridge_line} label="Copy bridge line" /></span> : null],
        ]} />
      </Panel>

      <Panel title="Clients" description={clients?.since ? `Users seen by this bridge since ${clients.since} (UTC); Tor rounds the numbers up.` : 'Users seen by this bridge.'} action={clients ? <Badge variant="outline">{clients.total} total</Badge> : undefined}>
        {!clients || clients.countries.length === 0 ? <Empty>Tor has not collected client statistics yet - this takes about a day. It needs <code>BridgeRelay 1</code> and a running time of 24 hours.</Empty> : (
          <div className="space-y-4">
            <ul className="space-y-2 text-sm">
              {clients.countries.slice(0, 12).map((c) => (
                <li key={c.country} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3">
                  <span className="truncate" title={countryName(c.country)}>{countryName(c.country)}</span>
                  <span className="h-2 rounded-full bg-muted"><span className="block h-2 rounded-full bg-chart-1" style={{ width: `${(c.count / max) * 100}%` }} /></span>
                  <span className="text-right font-mono tabular-nums">{c.count}</span>
                </li>
              ))}
            </ul>
            {Object.keys(clients.ip_versions).length > 0 && (
              <p className="text-xs text-muted-foreground">{Object.entries(clients.ip_versions).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(' · ')}</p>
            )}
          </div>
        )}
      </Panel>
    </div>
  )
}
