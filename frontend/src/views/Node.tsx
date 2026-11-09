import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { BridgeInfo, Overview } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { CopyButton, Empty, KeyValues, Panel, RoleBadges } from '@/components/common'
import { formatDuration } from '@/lib/format'
import { BridgePanel } from '@/views/Health'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'

const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'secondary'> = {
  recommended: 'success', 'new in series': 'success', new: 'success', obsolete: 'destructive', old: 'destructive', unrecommended: 'destructive',
}

export function NodeView({ overview, bridge }: { overview: Overview; bridge: BridgeInfo | null }) {
  const t = overview.tor
  const [q, setQ] = useState('')
  const config = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? overview.config.filter((c) => (c.name + ' ' + c.values.join(' ')).toLowerCase().includes(needle)) : overview.config
  }, [overview.config, q])

  return (
    <div className="space-y-6">
      <Panel title="Tor" description="Local status of the controlled node.">
        <KeyValues rows={[
          ['Version', <span className="font-mono">{t.version}</span>],
          ['Version status', <Badge variant={STATUS_VARIANT[t.version_status] ?? 'secondary'}>{t.version_status}</Badge>],
          ['Latest stable', t.latest_stable ? <>{t.latest_stable} {t.is_latest_stable && <Badge variant="success" className="ml-2">current</Badge>}</> : null],
          ['Latest unstable', t.latest_unstable && t.latest_unstable !== t.latest_stable ? t.latest_unstable : null],
          ['Uptime', t.uptime != null ? formatDuration(t.uptime) : null],
          ['PID', t.pid],
          ['User', t.user],
          ['Role', <RoleBadges mode={t.mode} flags={t.flags} />],
          ['Nickname', t.nickname],
          ['Fingerprint', t.fingerprint ? <span className="flex items-start gap-1"><span className="break-all font-mono text-xs leading-6">{t.fingerprint}</span><CopyButton value={t.fingerprint} label="Copy fingerprint" /></span> : null],
          ['Control connection', t.is_localhost ? 'local' : 'remote'],
          ['Flags', t.flags.length ? <div className="flex flex-wrap gap-1.5">{t.flags.map((f) => <Badge key={f} variant="secondary">{f}</Badge>)}</div> : null],
        ]} />
      </Panel>

      {bridge && <BridgePanel bridge={bridge} />}

      {overview.hidden_services.length > 0 && (
        <Panel title="Hidden services" description={`${overview.hidden_services.length} configured`}>
          <div className="space-y-6">
            {overview.hidden_services.map((hs) => (
              <div key={hs.dir}>
                <div className="mb-2 font-mono text-xs text-muted-foreground">{hs.dir}</div>
                <KeyValues rows={Object.entries(hs.options).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)] as [string, string])} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Configuration"
        description={`${q.trim() ? `${config.length} of ` : ''}${overview.config.length} option${overview.config.length === 1 ? '' : 's'} that differ from Tor's defaults.`}
        action={
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <input type="search" aria-label="Filter options" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="h-9 w-48 rounded-md border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
        }
      >
        {config.length === 0 ? <Empty>{overview.config.length ? 'No matching options.' : 'Tor runs with its default configuration.'}</Empty> : (
          <Table>
            <TableBody>
              {config.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="w-64 align-top font-mono text-xs">{c.name}</TableCell>
                  <TableCell className="break-all font-mono text-xs text-muted-foreground">{c.values.map((v, i) => <div key={i}>{v}</div>)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  )
}
