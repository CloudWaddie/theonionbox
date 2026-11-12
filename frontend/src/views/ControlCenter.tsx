import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleAlert, Loader2, LogOut, Pencil, Plus, Search, Server, ShieldAlert, Trash2, Waypoints, WifiOff, X } from 'lucide-react'
import { ApiError, ccApi, type CCNode, type BwSample, type NodeForm } from '@/lib/cc'
import { formatBytes, formatRate } from '@/lib/format'
import { Footer, TopBar } from '@/components/shell'
import { Sparkline } from '@/components/charts'
import { Blur, RoleBadges, Skeleton, Stat } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const POLL_MS = 2500
const HIDDEN_MS = 10_000   // nobody is looking: just keep the session alive
const KEEP = 90
const text = (e: unknown) => (e instanceof Error ? e.message : String(e))

// polls the node list, keeps the last samples per node for the sparklines
function useNodes() {
  const [nodes, setNodes] = useState<CCNode[]>([])
  const [history, setHistory] = useState<Record<string, BwSample[]>>({})
  const [readonly, setReadonly] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const since = useRef<number | undefined>(undefined)
  const shift = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)
  const failures = useRef(0)
  const round = useRef(0)

  const refresh = useCallback(async (reset = false) => {
    if (reset) since.current = undefined
    const mine = ++round.current
    try {
      const data = await ccApi.list(since.current)
      // an answer that was overtaken by a newer request (e.g. after a change) is stale
      if (!alive.current || mine !== round.current) return
      if (shift.current === null) shift.current = Date.now() - data.tick
      const dt = shift.current
      since.current = data.tick
      setNodes(data.nodes)
      setReadonly(data.readonly)
      setHistory((h) => {
        const next: Record<string, BwSample[]> = {}
        for (const n of data.nodes) {
          const have = reset ? [] : h[n.id] ?? []
          const last = have.length ? have[have.length - 1].s : -Infinity
          const fresh = (n.bw ?? []).map((p) => ({ ...p, s: p.s + dt })).filter((p) => p.s > last)
          next[n.id] = fresh.length || reset ? [...have, ...fresh].slice(-KEEP) : have
        }
        return next
      })
      failures.current = 0
      setError(null)
    } catch (e) {
      if (!alive.current || mine !== round.current) return
      if (e instanceof ApiError && e.status === 404) return setExpired(true)
      failures.current += 1
      // a single lost answer is not worth a red banner
      if (failures.current > 1) setError(text(e))
    } finally {
      if (alive.current) setLoaded(true)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    let stopped = false
    let running = false
    const tick = async () => {
      if (running) return   // never two chains of polls
      running = true
      try { await refresh() } finally { running = false }
      if (stopped) return
      const wait = document.hidden ? HIDDEN_MS : Math.min(15_000, POLL_MS * 2 ** Math.min(failures.current, 3))
      clearTimeout(timer.current)
      timer.current = setTimeout(tick, wait)
    }
    const wake = () => { if (!document.hidden && !stopped) { clearTimeout(timer.current); tick() } }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    tick()
    return () => {
      stopped = true; alive.current = false
      clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
    }
  }, [refresh])

  return { nodes, setNodes, history, readonly, loaded, error, expired, refresh }
}

const STATE_BADGE = {
  ok: ['success', 'Online'], connecting: ['warning', 'Connecting'], auth: ['destructive', 'Login needed'], offline: ['destructive', 'Offline'],
} as const

const UP_COLOR = 'hsl(var(--chart-1))', DOWN_COLOR = 'hsl(var(--chart-2))'

function Traffic({ samples }: { samples: BwSample[] }) {
  const lines = useMemo(() => [
    { values: samples.map((p) => Math.abs(p.r)), color: DOWN_COLOR },
    { values: samples.map((p) => Math.abs(p.w)), color: UP_COLOR },
  ], [samples])
  return <Sparkline lines={lines} minTop={5000} />
}

const COUNTRY_NAMES = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(undefined, { type: 'region' }) : null
const countryName = (cc: string) => { try { return COUNTRY_NAMES?.of(cc) ?? cc } catch { return cc } }

function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

// stats of a Snowflake proxy, from its -metrics endpoint
function SnowflakeBody({ node }: { node: CCNode }) {
  const sf = node.snowflake!
  const history = sf.history ?? []
  const last = history[history.length - 1]
  const attempts = sf.connections_1h + sf.timeouts_1h
  return (
    <>
      <Traffic samples={history} />
      <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-sm tabular-nums">
        <span className="flex items-center gap-1.5" title="Sent to clients"><ArrowUp className="size-3.5 text-chart-1" />{formatRate(last ? last.w : null)}</span>
        <span className="flex items-center gap-1.5" title="Received from clients"><ArrowDown className="size-3.5 text-chart-2" />{formatRate(last ? last.r : null)}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Clients, last hour</dt>
        <dd className="text-right font-mono tabular-nums">{sf.connections_1h}{attempts > 0 && <span className="text-muted-foreground"> · {Math.round((sf.timeouts_1h / attempts) * 100)}% timed out</span>}</dd>
        <dt className="text-muted-foreground">Traffic, last hour</dt>
        <dd className="text-right font-mono tabular-nums">{formatBytes(sf.inbound_1h + sf.outbound_1h)}</dd>
        <dt className="text-muted-foreground">Since proxy start</dt>
        <dd className="text-right font-mono tabular-nums">
          {sf.connections} clients ·{' '}
          <ArrowUp className="inline size-3 text-chart-1 align-[-1px]" />{formatBytes(sf.outbound)}{' '}
          <ArrowDown className="inline size-3 text-chart-2 align-[-1px]" />{formatBytes(sf.inbound)}
        </dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {node.health && node.health.status !== 'ok' && <Badge variant="warning" title={node.health.issues.join(', ')}>Check: {node.health.issues.slice(0, 2).join(', ')}</Badge>}
        {(sf.countries ?? []).slice(0, 5).map((c) => <Badge key={c.cc} variant="secondary" title={`${countryName(c.cc)}: ${c.n} clients since the proxy started`}>{c.cc === '??' ? 'Unknown' : c.cc} {c.n}</Badge>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Counters updated {ago(sf.updated)}</p>
    </>
  )
}

function NodeCard({ node, samples, canMoveLeft, canMoveRight, onMove, onEdit, onOpen, opening }: {
  node: CCNode; samples: BwSample[]; canMoveLeft: boolean; canMoveRight: boolean
  onMove: (dir: -1 | 1) => void; onEdit: () => void; onOpen: () => void; opening: boolean
}) {
  const [variant, text] = STATE_BADGE[node.state] ?? STATE_BADGE.offline
  const last = samples[samples.length - 1]
  const title = node.label || node.nickname || node.host || (node.control === 'snowflake' ? 'Snowflake proxy' : 'Tor node')
  const address = node.control === 'socket' ? node.host : node.host ? `${node.host}${node.port ? `:${node.port}` : ''}` : 'this machine'

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold tracking-tight">{title}</h3>
          </div>
          <RoleBadges mode={node.mode} flags={node.flags} className="mt-1.5" />
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={node.mode === 'Bridge' ? undefined : address ?? ''}><Blur on={node.mode === 'Bridge'}>{address}</Blur>{node.control === 'proxy' ? ' · via Tor' : ''}</p>
        </div>
        <Badge variant={variant} className="shrink-0">
          {node.state === 'connecting' ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
          {text}
        </Badge>
      </div>

      <div className="flex-1 px-5">
        {node.state === 'ok' && node.snowflake ? (
          <SnowflakeBody node={node} />
        ) : node.state === 'ok' ? (
          <>
            <Traffic samples={samples} />
            <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-sm tabular-nums">
              <span className="flex items-center gap-1.5"><ArrowUp className="size-3.5 text-chart-1" />{formatRate(last ? Math.abs(last.w) : null)}</span>
              <span className="flex items-center gap-1.5"><ArrowDown className="size-3.5 text-chart-2" />{formatRate(last ? Math.abs(last.r) : null)}</span>
            </div>
            {(node.lifetime && (node.lifetime.up > 0 || node.lifetime.down > 0)) && (
              <p className="mt-1 text-xs text-muted-foreground">
                Lifetime:{' '}
                <span className="font-mono tabular-nums"><ArrowUp className="mr-0.5 inline size-3 text-chart-1 align-[-1px]" />{formatBytes(node.lifetime.up ?? 0)}</span>
                {' · '}
                <span className="font-mono tabular-nums"><ArrowDown className="mr-0.5 inline size-3 text-chart-2 align-[-1px]" />{formatBytes(node.lifetime.down ?? 0)}</span>
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="outline">Tor {node.version}</Badge>
              {node.version_status && node.version_status !== 'recommended' && node.version_status !== 'unknown' && <Badge variant="warning">{node.version_status}</Badge>}
              {node.hibernating && <Badge variant="warning">{node.hibernating}</Badge>}
              {node.health && node.health.status !== 'ok' && <Badge variant={node.health.status === 'fail' ? 'destructive' : 'warning'} title={node.health.issues.join(', ')}>{node.health.status === 'fail' ? 'Problem' : 'Check'}: {node.health.issues.slice(0, 2).join(', ')}</Badge>}
              {(node.flags ?? []).slice(0, 5).map((f) => <Badge key={f} variant="secondary">{f}</Badge>)}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{(node.circuits ?? 0).toLocaleString()} circuits · {(node.connections ?? 0).toLocaleString()} OR connections · {(node.streams ?? 0).toLocaleString()} streams</p>
            {node.fingerprint && node.mode !== 'Bridge' && <p className="mt-1 truncate font-mono text-[0.7rem] text-muted-foreground" title={node.fingerprint}>{node.fingerprint}</p>}
          </>
        ) : node.state === 'connecting' ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Connecting…</div>
        ) : (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            {node.state === 'auth' ? <ShieldAlert className="size-5 text-destructive" /> : <WifiOff className="size-5 text-destructive" />}
            <span className="line-clamp-4 break-words">{node.state === 'auth' ? <>Authentication failed. Edit this node to set its control password or cookie.<span className="mt-1 block text-xs opacity-70">{node.error}</span></> : node.error || 'The node does not answer.'}</span>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2.5">
        <div className="flex items-center">
          {node.editable && (
            <>
              <Button variant="ghost" size="icon" className="size-8" disabled={!canMoveLeft} onClick={() => onMove(-1)} aria-label="Move earlier"><ArrowLeft /></Button>
              <Button variant="ghost" size="icon" className="size-8" disabled={!canMoveRight} onClick={() => onMove(1)} aria-label="Move later"><ArrowRight /></Button>
              <Button variant="ghost" size="icon" className="size-8" onClick={onEdit} aria-label="Edit node"><Pencil /></Button>
            </>
          )}
        </div>
        {node.control !== 'snowflake' && <Button size="sm" variant="outline" onClick={onOpen} disabled={node.state === 'offline' || opening}>{opening && <Loader2 className="animate-spin" />}Details</Button>}
      </div>
    </Card>
  )
}

const rateOf = (n: CCNode, samples: BwSample[]): [number, number] => {
  const list = n.snowflake ? n.snowflake.history ?? [] : samples
  const last = list[list.length - 1]
  return n.state === 'ok' && last ? [Math.abs(last.w), Math.abs(last.r)] : [0, 0]
}

export function ControlCenterView({ version, logout }: { version: string; logout: boolean }) {
  const { nodes, setNodes, history, readonly, loaded, error, expired, refresh } = useNodes()
  const [editing, setEditing] = useState<CCNode | 'new' | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const editable = useMemo(() => nodes.filter((n) => n.editable).map((n) => n.id), [nodes])

  const totals = useMemo(() => {
    let online = 0, up = 0, down = 0, circuits = 0, clients = 0, lifeUp = 0, lifeDown = 0
    const trouble: string[] = []
    for (const n of nodes) {
      const name = n.label || n.nickname || n.host || 'node'
      if (n.state === 'ok') online++
      else if (n.state !== 'connecting') trouble.push(`${name}: ${n.state === 'auth' ? 'login needed' : 'offline'}`)
      if (n.state === 'ok' && n.health && n.health.status !== 'ok') trouble.push(`${name}: ${n.health.issues.slice(0, 2).join(', ') || 'needs attention'}`)
      const [w, r] = rateOf(n, history[n.id] ?? [])
      up += w; down += r
      lifeUp += n.lifetime?.up ?? 0
      lifeDown += n.lifetime?.down ?? 0
      circuits += n.state === 'ok' ? n.circuits ?? 0 : 0
      clients += n.state === 'ok' ? n.snowflake?.connections_1h ?? 0 : 0
    }
    return { online, up, down, circuits, clients, lifeUp, lifeDown, trouble }
  }, [nodes, history])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return nodes
    return nodes.filter((n) => [n.label, n.nickname, n.host, n.mode, n.state, n.fingerprint, n.version, ...(n.flags ?? [])].some((v) => v && String(v).toLowerCase().includes(needle)))
  }, [nodes, q])

  useEffect(() => {
    document.title = nodes.length ? `${totals.online}/${nodes.length} online · The Onion Box` : 'The Onion Box'
  }, [totals.online, nodes.length])

  async function open(n: CCNode) {
    setOpening(n.id)
    setFailure(null)
    try {
      location.assign((await ccApi.open(n.id)).path)
    } catch (e) {
      setFailure(text(e))
      setOpening(null)
    }
  }

  async function move(n: CCNode, dir: -1 | 1) {
    const order = [...editable]
    const i = order.indexOf(n.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    // show the new order right away, the Box confirms it with the next answer
    setNodes((list) => {
      const a = list.findIndex((x) => x.id === order[i]), b = list.findIndex((x) => x.id === order[j])
      if (a < 0 || b < 0) return list
      const next = [...list]
      ;[next[a], next[b]] = [next[b], next[a]]
      return next
    })
    try { await ccApi.order(order); setFailure(null) } catch (e) { setFailure(text(e)) }
    refresh()
  }

  return (
    <div className="min-h-screen">
      <TopBar actions={logout && <Button variant="outline" size="sm" asChild><a href="cc/logout"><LogOut /><span className="hidden sm:inline">Logout</span></a></Button>}>
        <span className="hidden text-muted-foreground sm:inline">/</span><span className="hidden font-medium sm:inline">All nodes</span>
      </TopBar>

      <main className="container py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Control Center</h1>
            <p className="text-sm text-muted-foreground">Relays, bridges, clients and Snowflake proxies in one place.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {nodes.length > 3 && (
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <input type="search" aria-label="Filter nodes" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter nodes…" className="h-9 w-44 rounded-md border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
            )}
            {!readonly && <Button onClick={() => setEditing('new')}><Plus />Add node</Button>}
          </div>
        </div>

        {readonly && <p className="mb-6 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">The configuration file is read-only: nodes can be viewed but not changed.</p>}
        {failure ? (
          <p role="alert" className="mb-6 flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span className="min-w-0 break-words">{failure}</span>
            <button type="button" onClick={() => setFailure(null)} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-destructive/10"><X className="size-4" /></button>
          </p>
        ) : error && !expired ? (
          <p role="alert" className="mb-6 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">Lost contact with the Box ({error}) – trying again…</p>
        ) : null}

        {!loaded ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>
        ) : nodes.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-16 text-center">
            <Server className="size-8 text-muted-foreground" />
            <h2 className="font-semibold">No nodes yet</h2>
            <p className="max-w-sm text-sm text-muted-foreground">Add the ControlPort of a relay, bridge or client, or the metrics port of a Snowflake proxy, to start monitoring it.</p>
            {!readonly && <Button onClick={() => setEditing('new')}><Plus />Add your first node</Button>}
          </Card>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Online" icon={<Server />} value={<>{totals.online}<span className="text-base font-normal text-muted-foreground"> / {nodes.length}</span></>}
                hint={totals.trouble.length ? <span className="text-warning" title={totals.trouble.join('\n')}><CircleAlert className="mr-1 inline size-3.5 align-[-2px]" />{totals.trouble.length} need{totals.trouble.length === 1 ? 's' : ''} attention</span> : 'all healthy'} />
              <Stat label="Upload" icon={<ArrowUp />} value={formatRate(totals.up)}
                hint={<span className="flex items-center gap-1"><ArrowUp className="size-3" />{formatBytes(totals.lifeUp)}<span className="text-muted-foreground">lifetime</span></span>} />
              <Stat label="Download" icon={<ArrowDown />} value={formatRate(totals.down)}
                hint={<span className="flex items-center gap-1"><ArrowDown className="size-3" />{formatBytes(totals.lifeDown)}<span className="text-muted-foreground">lifetime</span></span>} />
              <Stat label="Circuits" icon={<Waypoints />} value={totals.circuits.toLocaleString()} hint={totals.clients ? `${totals.clients.toLocaleString()} Snowflake clients last hour` : 'across all Tor nodes'} />
            </div>
            {shown.length === 0 ? (
              <p className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">No node matches “{q.trim()}”.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((n) => {
                  const i = editable.indexOf(n.id)
                  return <NodeCard key={n.id} node={n} samples={history[n.id] ?? []} opening={opening === n.id}
                    canMoveLeft={!q.trim() && i > 0} canMoveRight={!q.trim() && i >= 0 && i < editable.length - 1}
                    onMove={(d) => move(n, d)} onEdit={() => setEditing(n)} onOpen={() => open(n)} />
                })}
              </div>
            )}
          </>
        )}

        <Footer version={version} />
      </main>

      {editing && <NodeDialog node={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(true) }} />}

      {expired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="max-w-sm space-y-4 rounded-lg border bg-card p-6 text-center shadow-lg">
            <h2 className="text-lg font-semibold">Session expired</h2>
            <p className="text-sm text-muted-foreground">The Box closed this session. Start a new one to continue.</p>
            <Button asChild><a href="../">Start a new session</a></Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

const COOKIE_HINT =
  "For nodes using CookieAuthentication on another machine: the content of Tor's control_auth_cookie as hex. " +
  "On the node run  od -An -v -tx1 /run/tor/control.authcookie | tr -d ' \\n'  (Debian / Ubuntu package; otherwise the control_auth_cookie in your DataDirectory). " +
  'Not needed if the Box can read that file itself.'

const CONTROL_HELP = {
  port: 'ControlPort over TCP. Use a private network (VPN, WireGuard, Tailscale, same host): never expose a ControlPort to the internet.',
  socket: 'Path of a local ControlSocket (a node on the same machine / a shared volume).',
  proxy: 'Reach the node through Tor itself, e.g. a ControlPort published as an onion service.',
  snowflake: 'The metrics port of a Snowflake proxy, started with -metrics -metrics-address 0.0.0.0. Firewall that port so only this Box can reach it, and use -summary-interval 1m for minute-by-minute stats.',
}

function NodeDialog({ node, onClose, onDone }: { node: CCNode | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    label: node?.label ?? '',
    control: (node?.control ?? 'port') as NodeForm['control'],
    host: node?.host ?? '',
    port: node?.port ?? '9051',
    password: '',
    cookie: '',
    controlCookie: '',
  })
  const [removePassword, setRemovePassword] = useState(false)
  const [removeControlCookie, setRemoveControlCookie] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<{ ok: boolean; message: string; methods: string[] } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const needsCookie = !!test?.methods.some((m) => m.includes('COOKIE'))
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value
    const next = { ...form, [k]: value }
    // switching the type: offer that type's usual port
    if (k === 'control' && (form.port === '9051' || form.port === '9999')) next.port = value === 'snowflake' ? '9999' : '9051'
    setForm(next); setTest(null)
  }
  const isSnowflake = form.control === 'snowflake'

  const payload = (): NodeForm => isSnowflake ? {
    label: form.label, control: form.control, host: form.host, port: form.port,
    ...(node ? {} : { password: '' }),
  } : ({
    label: form.label,
    control: form.control,
    host: form.host,
    port: form.control === 'socket' ? '' : form.port,
    ...(form.password ? { password: form.password } : removePassword ? { password: '' } : node ? {} : { password: '' }),
    ...(form.cookie ? { cookie: form.cookie } : {}),
    ...(form.controlCookie ? { control_cookie: form.controlCookie.trim() } : removeControlCookie ? { control_cookie: '' } : {}),
  })

  async function run<T>(fn: () => Promise<T>, then?: (r: T) => void) {
    setBusy(true); setError(null)
    try { const r = await fn(); then?.(r) } catch (e) { setError(text(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{node ? 'Edit node' : 'Add node'}</DialogTitle>
          <DialogDescription>Relays, bridges and clients are monitored through their Tor ControlPort, Snowflake proxies through their metrics port. Credentials are stored in the Box's configuration file.</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); run(() => (node ? ccApi.edit(node.id, payload()) : ccApi.add(payload())), onDone) }}>
          <Field id="label" label="Name" hint={isSnowflake ? 'Optional. Defaults to the host.' : 'Optional. Defaults to the nickname of the node.'}>
            <Input id="label" value={form.label} onChange={set('label')} maxLength={64} placeholder={isSnowflake ? 'e.g. snowflake-racknerd' : 'e.g. frankfurt-relay'} />
          </Field>

          <Field id="control" label="Connection" hint={CONTROL_HELP[form.control]}>
            <select id="control" value={form.control} onChange={set('control')} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="port">ControlPort (TCP)</option>
              <option value="proxy">ControlPort via Tor (onion service)</option>
              <option value="socket">ControlSocket (file)</option>
              <option value="snowflake">Snowflake proxy (metrics port)</option>
            </select>
          </Field>

          <div className="grid grid-cols-[1fr_6.5rem] gap-3">
            <Field id="host" label={form.control === 'socket' ? 'Socket path' : 'Host'}>
              <Input id="host" value={form.host} onChange={set('host')} required placeholder={form.control === 'socket' ? '/var/run/tor/control' : form.control === 'proxy' ? 'abc…xyz.onion' : isSnowflake ? '203.0.113.7' : '10.0.0.5'} autoComplete="off" />
            </Field>
            {form.control !== 'socket' && (
              <Field id="port" label="Port"><Input id="port" inputMode="numeric" value={form.port} onChange={set('port')} required /></Field>
            )}
          </div>

          {!isSnowflake && <>
          <Field id="password" label="Control password" hint={node?.has_password && !removePassword ? 'A password is stored. Leave empty to keep it.' : 'The HashedControlPassword of the node. Leave empty for cookie / no authentication.'}>
            <Input id="password" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" placeholder={node?.has_password && !removePassword ? '••••••••' : ''} disabled={removePassword} />
          </Field>
          {node?.has_password && (
            <label className="-mt-2 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} />Remove the stored password</label>
          )}

          <Field
            id="control_cookie"
            label="Control cookie"
            hint={node?.has_control_cookie && !removeControlCookie
              ? 'A cookie is stored. Leave empty to keep it.'
              : COOKIE_HINT}
          >
            <Input id="control_cookie" type="password" value={form.controlCookie} onChange={set('controlCookie')} autoComplete="off" spellCheck={false} maxLength={64} placeholder={node?.has_control_cookie && !removeControlCookie ? '••••••••' : '64 hex characters'} disabled={removeControlCookie} className="font-mono" />
          </Field>
          {node?.has_control_cookie && (
            <label className="-mt-2 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={removeControlCookie} onChange={(e) => setRemoveControlCookie(e.target.checked)} />Remove the stored control cookie</label>
          )}

          {form.control === 'proxy' && (
            <Field id="cookie" label="Onion authorization cookie" hint={node?.has_cookie ? 'A cookie is stored. Leave empty to keep it.' : 'Optional: only for onion services using HiddenServiceAuthorizeClient.'}>
              <Input id="cookie" value={form.cookie} onChange={set('cookie')} autoComplete="off" maxLength={22} />
            </Field>
          )}
          </>}

          {test && (
            <p className={`rounded-md border px-3 py-2 text-sm ${test.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}>
              {test.message}{test.ok && test.methods.length > 0 && <span className="text-muted-foreground"> Authentication: {test.methods.join(', ').toLowerCase()}.{needsCookie && !form.controlCookie && !node?.has_control_cookie ? ' If the Box cannot read the cookie file, enter the control cookie below.' : ''}</span>}
            </p>
          )}
          {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <DialogFooter className="sm:justify-between">
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy || !form.host} onClick={() => run(() => ccApi.test({ control: form.control, host: form.host, port: form.port, cookie: form.cookie || undefined }), setTest)}>Test connection</Button>
              {node && <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 />Remove</Button>}
            </div>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{node ? 'Save' : 'Add node'}</Button>
          </DialogFooter>
        </form>

        {confirmDelete && node && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p>Remove <b>{node.label || node.nickname || node.host}</b> from the Control Center? The node itself is not touched.</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => ccApi.remove(node.id), onDone)}>Yes, remove</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
