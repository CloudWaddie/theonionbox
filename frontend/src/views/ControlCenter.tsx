import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Loader2, LogOut, Pencil, Plus, Server, ShieldAlert, Trash2, WifiOff } from 'lucide-react'
import { ApiError, ccApi, type CCNode, type BwSample, type NodeForm } from '@/lib/cc'
import { formatRate } from '@/lib/format'
import { Footer, TopBar } from '@/components/shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const POLL_MS = 2500
const KEEP = 90

// polls the node list, keeps the last samples per node for the sparklines
function useNodes() {
  const [nodes, setNodes] = useState<CCNode[]>([])
  const [history, setHistory] = useState<Record<string, BwSample[]>>({})
  const [readonly, setReadonly] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const since = useRef<number | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)

  const refresh = useCallback(async (reset = false) => {
    if (reset) since.current = undefined
    try {
      const data = await ccApi.list(since.current)
      if (!alive.current) return
      const shift = Date.now() - data.tick
      since.current = data.tick
      setNodes(data.nodes)
      setReadonly(data.readonly)
      setHistory((h) => {
        const next: Record<string, BwSample[]> = {}
        for (const n of data.nodes) {
          const fresh = (n.bw ?? []).map((p) => ({ ...p, s: p.s + shift }))
          next[n.id] = [...(reset ? [] : h[n.id] ?? []), ...fresh].slice(-KEEP)
        }
        return next
      })
      setError(null)
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (alive.current) setLoaded(true)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    const tick = async () => {
      await refresh()
      if (alive.current) timer.current = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { alive.current = false; clearTimeout(timer.current) }
  }, [refresh])

  return { nodes, history, readonly, loaded, error, refresh }
}

const STATE_BADGE = {
  ok: ['success', 'Online'], connecting: ['warning', 'Connecting'], auth: ['destructive', 'Login needed'], offline: ['destructive', 'Offline'],
} as const

function Sparkline({ samples }: { samples: BwSample[] }) {
  const data = samples.map((p) => ({ t: p.s, up: Math.abs(p.w), down: Math.abs(p.r) }))
  if (data.length < 2) return <div className="h-14 rounded-md bg-muted/50" />
  return (
    <div className="h-14">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <YAxis hide domain={[0, (m: number) => Math.max(m, 5000)]} />
          <Area dataKey="down" type="monotone" stroke="hsl(var(--chart-2))" strokeWidth={1.5} fill="hsl(var(--chart-2))" fillOpacity={0.12} dot={false} isAnimationActive={false} />
          <Area dataKey="up" type="monotone" stroke="hsl(var(--chart-1))" strokeWidth={1.5} fill="hsl(var(--chart-1))" fillOpacity={0.12} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function NodeCard({ node, samples, canMoveLeft, canMoveRight, onMove, onEdit, onOpen, opening }: {
  node: CCNode; samples: BwSample[]; canMoveLeft: boolean; canMoveRight: boolean
  onMove: (dir: -1 | 1) => void; onEdit: () => void; onOpen: () => void; opening: boolean
}) {
  const [variant, text] = STATE_BADGE[node.state]
  const last = samples[samples.length - 1]
  const title = node.label || node.nickname || node.host || 'Tor node'
  const address = node.control === 'socket' ? node.host : node.host ? `${node.host}${node.port ? `:${node.port}` : ''}` : 'this machine'

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold tracking-tight">{title}</h3>
            {node.mode && <Badge variant="secondary">{node.mode}</Badge>}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={address ?? ''}>{address}{node.control === 'proxy' ? ' · via Tor' : ''}</p>
        </div>
        <Badge variant={variant} className="shrink-0">
          {node.state === 'connecting' ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
          {text}
        </Badge>
      </div>

      <div className="flex-1 px-5">
        {node.state === 'ok' ? (
          <>
            <Sparkline samples={samples} />
            <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-sm tabular-nums">
              <span className="flex items-center gap-1.5"><ArrowUp className="size-3.5 text-chart-1" />{formatRate(last ? Math.abs(last.w) : null)}</span>
              <span className="flex items-center gap-1.5"><ArrowDown className="size-3.5 text-chart-2" />{formatRate(last ? Math.abs(last.r) : null)}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="outline">Tor {node.version}</Badge>
              {node.version_status && node.version_status !== 'recommended' && node.version_status !== 'unknown' && <Badge variant="warning">{node.version_status}</Badge>}
              {node.hibernating && <Badge variant="warning">{node.hibernating}</Badge>}
              {(node.flags ?? []).slice(0, 5).map((f) => <Badge key={f} variant="secondary">{f}</Badge>)}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{node.circuits ?? 0} circuits · {node.connections ?? 0} OR connections</p>
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
        <Button size="sm" variant="outline" onClick={onOpen} disabled={node.state === 'offline' || opening}>{opening && <Loader2 className="animate-spin" />}Details</Button>
      </div>
    </Card>
  )
}

export function ControlCenterView({ version, logout }: { version: string; logout: boolean }) {
  const { nodes, history, readonly, loaded, error, refresh } = useNodes()
  const [editing, setEditing] = useState<CCNode | 'new' | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const editable = useMemo(() => nodes.filter((n) => n.editable).map((n) => n.id), [nodes])

  async function open(n: CCNode) {
    setOpening(n.id)
    try {
      location.assign((await ccApi.open(n.id)).path)
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
      setOpening(null)
    }
  }

  async function move(n: CCNode, dir: -1 | 1) {
    const order = [...editable]
    const i = order.indexOf(n.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    try { await ccApi.order(order) } catch (e) { setFailure(e instanceof Error ? e.message : String(e)) }
    refresh(true)
  }

  return (
    <div className="min-h-screen">
      <TopBar actions={logout && <Button variant="outline" size="sm" asChild><a href="cc/logout"><LogOut /> Logout</a></Button>}>
        <span className="text-muted-foreground">/</span><span className="font-medium">All nodes</span>
      </TopBar>

      <main className="container py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Control Center</h1>
            <p className="text-sm text-muted-foreground">{nodes.length} node{nodes.length === 1 ? '' : 's'} · relays, bridges and clients in one place</p>
          </div>
          {!readonly && <Button onClick={() => setEditing('new')}><Plus />Add node</Button>}
        </div>

        {readonly && <p className="mb-6 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">The configuration file is read-only: nodes can be viewed but not changed.</p>}
        {(error || failure) && <p role="alert" className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{failure ?? `Lost contact with the Box (${error}).`}</p>}

        {!loaded ? (
          <div className="py-24 text-center text-sm text-muted-foreground">Loading…</div>
        ) : nodes.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
            <Server className="size-8 text-muted-foreground" />
            <h2 className="font-semibold">No nodes yet</h2>
            <p className="max-w-sm text-sm text-muted-foreground">Add the ControlPort of a relay, bridge or client to start monitoring it.</p>
            {!readonly && <Button onClick={() => setEditing('new')}><Plus />Add your first node</Button>}
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {nodes.map((n) => {
              const i = editable.indexOf(n.id)
              return <NodeCard key={n.id} node={n} samples={history[n.id] ?? []} opening={opening === n.id}
                canMoveLeft={i > 0} canMoveRight={i >= 0 && i < editable.length - 1}
                onMove={(d) => move(n, d)} onEdit={() => setEditing(n)} onOpen={() => open(n)} />
            })}
          </div>
        )}

        <Footer version={version} />
      </main>

      {editing && <NodeDialog node={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(true) }} />}
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
  "On the node run  od -An -v -tx1 /var/lib/tor/control_auth_cookie | tr -d ' \\n'  (path as in your DataDirectory). " +
  'Not needed if the Box can read that file itself.'

const CONTROL_HELP = {
  port: 'ControlPort over TCP. Use a private network (VPN, WireGuard, Tailscale, same host): never expose a ControlPort to the internet.',
  socket: 'Path of a local ControlSocket (a node on the same machine / a shared volume).',
  proxy: 'Reach the node through Tor itself, e.g. a ControlPort published as an onion service.',
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
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setForm({ ...form, [k]: e.target.value }); setTest(null) }

  const payload = (): NodeForm => ({
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
    try { const r = await fn(); then?.(r) } catch (e) { setError(e instanceof ApiError || e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{node ? 'Edit node' : 'Add node'}</DialogTitle>
          <DialogDescription>Relays, bridges and clients are monitored through their Tor ControlPort. Credentials are stored in the Box's configuration file.</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); run(() => (node ? ccApi.edit(node.id, payload()) : ccApi.add(payload())), onDone) }}>
          <Field id="label" label="Name" hint="Optional. Defaults to the nickname of the node.">
            <Input id="label" value={form.label} onChange={set('label')} maxLength={64} placeholder="e.g. frankfurt-relay" />
          </Field>

          <Field id="control" label="Connection" hint={CONTROL_HELP[form.control]}>
            <select id="control" value={form.control} onChange={set('control')} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="port">ControlPort (TCP)</option>
              <option value="proxy">ControlPort via Tor (onion service)</option>
              <option value="socket">ControlSocket (file)</option>
            </select>
          </Field>

          <div className="grid grid-cols-[1fr_6.5rem] gap-3">
            <Field id="host" label={form.control === 'socket' ? 'Socket path' : 'Host'}>
              <Input id="host" value={form.host} onChange={set('host')} required placeholder={form.control === 'socket' ? '/var/run/tor/control' : form.control === 'proxy' ? 'abc…xyz.onion' : '10.0.0.5'} autoComplete="off" />
            </Field>
            {form.control !== 'socket' && (
              <Field id="port" label="Port"><Input id="port" inputMode="numeric" value={form.port} onChange={set('port')} required /></Field>
            )}
          </div>

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
