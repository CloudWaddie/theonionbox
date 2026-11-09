import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Activity, ExternalLink, FileText, Globe2, LayoutGrid, LogOut, Server } from 'lucide-react'
import type { Overview, PageState } from '@/lib/types'
import { fetchOverview, getJson, useDashboard, useHealth } from '@/lib/useDashboard'
import { formatDuration, formatRate } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Footer, TopBar } from '@/components/shell'
import { CopyButton, ErrorBoundary, RoleBadges, Skeleton } from '@/components/common'
import { OverviewView } from '@/views/Overview'

// Everything but the first screen is split into its own chunk and fetched on demand (or ahead, when idle).
// A chunk that fails to load (a blip of the network) gets a second chance before the error boundary takes over.
function view<P>(load: () => Promise<ComponentType<P>>) {
  const safe = () => load().catch(() => new Promise((r) => setTimeout(r, 800)).then(load))
  return { View: lazy(() => safe().then((c) => ({ default: c }))), preload: () => { load().catch(() => {}) } }
}
const network = view(() => import('@/views/Network').then((m) => m.NetworkView))
const node = view(() => import('@/views/Node').then((m) => m.NodeView))
const logs = view(() => import('@/views/Logs').then((m) => m.LogsView))
const { View: LoginView } = view(() => import('@/views/Login').then((m) => m.LoginView))
const { View: ErrorView } = view(() => import('@/views/ErrorPage').then((m) => m.ErrorView))
const { View: ControlCenterView } = view(() => import('@/views/ControlCenter').then((m) => m.ControlCenterView))

const params = new URLSearchParams(location.search)
const isMock = params.has('mock')
// demo data is only loaded when asked for
const mock = isMock ? await import('@/mock') : null
mock?.installMockApi()

// Start fetching as soon as the script runs (not after React has mounted), and in parallel.
const statePromise = getJson<PageState>('api/state')
let overviewPromise: Promise<Overview> | null = null
statePromise.then((s) => { if (!mock && s.page !== 'login' && s.page !== 'error' && s.page !== 'cc') overviewPromise = fetchOverview() }).catch(() => {})

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function App() {
  const [state, setState] = useState<PageState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    statePromise.then(setState).catch((e) => setError(message(e)))
  }, [])

  if (error) return <Fatal message={error} />
  if (!state) return <Splash />

  return (
    <ErrorBoundary fallback={(e) => <Fatal message={e.message} reload />}>
      <Suspense fallback={<Splash />}>
        {state.page === 'login' ? <LoginView auth={state.auth} proceedTo={state.proceed_to} label={state.label} version={state.box} />
          : state.page === 'error' ? <ErrorView message={state.message} version={state.box} />
          : state.page === 'cc' ? <ControlCenterView version={state.box} logout={state.logout} />
          : <DashboardLoader />}
      </Suspense>
    </ErrorBoundary>
  )
}

// the frame of the page, so that nothing jumps once the data is there
function Splash() {
  return (
    <div className="min-h-screen" aria-busy="true" aria-label="Loading">
      <TopBar />
      <main className="container py-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="mt-6 h-80" />
      </main>
    </div>
  )
}

function Fatal({ message, reload }: { message: string; reload?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">{reload ? 'Something went wrong' : 'Session unavailable'}</h1>
      <p className="max-w-md break-words text-sm text-muted-foreground">
        {reload ? `The page ran into a problem (${message}).` : `The Box could not deliver this page (${message}). Your session may have expired.`}
      </p>
      <div className="flex gap-2">
        <Button variant={reload ? 'default' : 'outline'} onClick={() => location.reload()}>Reload</Button>
        <Button variant={reload ? 'outline' : 'default'} asChild><a href="../">Start a new session</a></Button>
      </div>
    </div>
  )
}

function DashboardLoader() {
  const [overview, setOverview] = useState<Overview | null>(mock?.mockOverview ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mock) return
    ;(overviewPromise ?? fetchOverview()).then(setOverview).catch((e) => setError(message(e)))
  }, [])

  if (error) return <Fatal message={error} />
  if (!overview) return <Splash />
  return <Dashboard overview={overview} />
}

const loadedAt = Date.now()
const TITLE = document.title

// A session ends after a short time of silence, e.g. when the laptop slept. Nothing is lost by just getting a new one;
// asking the user to press a button for it is only a nuisance. Guarded, so that a broken Box cannot make us loop.
function renewSession(): boolean {
  try {
    const last = Number(sessionStorage.getItem('tob-renewed') ?? 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem('tob-renewed', String(Date.now()))
  } catch {
    return false
  }
  location.replace(`../${location.hash}`)
  return true
}

function Dashboard({ overview }: { overview: Overview }) {
  const mockLive = useMemo(() => mock?.makeMock(), [])
  const live = useDashboard(overview, mockLive)
  const health = useHealth(mock?.mockHealth)
  const hasNetwork = overview.sections.includes('network') || !!live.ooBw || !!live.ooWeights
  const [wanted, setTab] = useState(() => location.hash.slice(1) || 'overview')
  const { header, tor } = overview
  // a bookmarked #network must not leave the page empty when this node has no network data
  const tab = ['overview', 'node', 'logs'].includes(wanted) || (wanted === 'network' && hasNetwork) ? wanted : 'overview'

  useEffect(() => {
    const idle: (f: () => void) => void = (window as any).requestIdleCallback ?? ((f) => setTimeout(f, 1500))
    idle(() => { node.preload(); logs.preload(); network.preload() })
  }, [])

  useEffect(() => { history.replaceState(null, '', `${location.pathname}${location.search}#${wanted}`) }, [wanted])

  // the current rates in the tab title: visible while working in another tab
  const now = live.mon['1s']?.[live.mon['1s'].length - 1]
  const up = now ? Math.abs(now.w) : null, down = now ? Math.abs(now.r) : null
  useEffect(() => {
    document.title = up == null ? `${header.title} · ${TITLE}` : `↑ ${formatRate(up)} ↓ ${formatRate(down)} · ${header.title}`
    return () => { document.title = TITLE }
  }, [up, down, header.title])

  // warnings & errors that arrived while the messages were not on screen
  const seen = useRef(0)
  const lastLog = live.logs.length ? live.logs[live.logs.length - 1].id : 0
  if (tab === 'logs') seen.current = lastLog
  const unseen = useMemo(() => live.logs.reduce((n, e) => n + (e.id > seen.current && (e.l === 'W' || e.l === 'E') ? 1 : 0), 0), [live.logs, tab])

  const [renewing, setRenewing] = useState(false)
  useEffect(() => {
    if (live.expired && !overview.cc && !mock) setRenewing(renewSession())
  }, [live.expired, overview.cc])

  const uptime = tor.uptime != null ? tor.uptime + (Date.now() - loadedAt) / 1000 : null

  return (
    <div className="min-h-screen">
      <TopBar
        actions={
          <>
            {overview.cc && <Button variant="ghost" size="sm" asChild><a href="../"><LayoutGrid /><span className="hidden sm:inline">All nodes</span></a></Button>}
            {header.logout && <Button variant="outline" size="sm" asChild><a href="logout.html"><LogOut /><span className="hidden sm:inline">Logout</span></a></Button>}
          </>
        }
      >
        <span className="hidden text-muted-foreground sm:inline">/</span>
        <span className="hidden truncate font-medium sm:inline">{header.title}</span>
        <Badge
          variant={live.connected ? 'success' : live.expired ? 'destructive' : 'warning'}
          className="shrink-0"
          title={live.lastUpdate ? `Last answer of the Box: ${new Date(live.lastUpdate).toLocaleTimeString()}` : undefined}
        >
          <span className={`size-1.5 rounded-full bg-current ${live.connected ? '' : 'animate-pulse'}`} />
          {live.connected ? 'Live' : live.expired ? 'Expired' : live.lastUpdate ? 'Reconnecting' : 'Connecting'}
        </Badge>
      </TopBar>

      <main className="container py-8">
        <div className="mb-8 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{header.title}</h1>
            <RoleBadges mode={tor.mode} flags={tor.flags} />
            {tor.hibernating && <Badge variant="warning">Hibernating</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Tor {header.tor_version} · {header.location}
            {uptime != null && <> · up {formatDuration(uptime)}</>}
          </p>
          {header.fingerprint && (
            <p className="flex items-center gap-1 text-muted-foreground">
              <span className="truncate font-mono text-xs">{header.fingerprint}</span>
              <CopyButton value={header.fingerprint} label="Copy fingerprint" />
              {tor.mode === 'Relay' && (
                <a href={`https://metrics.torproject.org/rs.html#details/${header.fingerprint}`} target="_blank" rel="noreferrer" title="Open in Tor Metrics Relay Search"
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground">
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </p>
          )}
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <div className="-mx-6 overflow-x-auto px-6">
            <TabsList>
              <TabsTrigger value="overview"><Activity className="mr-1.5 size-4" />Overview</TabsTrigger>
              {hasNetwork && <TabsTrigger value="network" onPointerEnter={network.preload}><Globe2 className="mr-1.5 size-4" />Network</TabsTrigger>}
              <TabsTrigger value="node" onPointerEnter={node.preload}><Server className="mr-1.5 size-4" />Node</TabsTrigger>
              <TabsTrigger value="logs" onPointerEnter={logs.preload}>
                <FileText className="mr-1.5 size-4" />Messages
                {unseen > 0 && <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 text-[0.7rem] font-semibold tabular-nums text-warning" title={`${unseen} new warnings or errors`}>{unseen > 99 ? '99+' : unseen}</span>}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="overview"><ErrorBoundary><OverviewView overview={overview} live={live} health={health?.health ?? null} /></ErrorBoundary></TabsContent>
          {hasNetwork && <TabsContent value="network"><ErrorBoundary><Suspense fallback={<TabSkeleton />}><network.View network={overview.network} ooBw={live.ooBw} ooWeights={live.ooWeights} /></Suspense></ErrorBoundary></TabsContent>}
          <TabsContent value="node"><ErrorBoundary><Suspense fallback={<TabSkeleton />}><node.View overview={overview} bridge={health?.bridge ?? null} /></Suspense></ErrorBoundary></TabsContent>
          <TabsContent value="logs"><ErrorBoundary><Suspense fallback={<TabSkeleton />}><logs.View logs={live.logs} levels={live.levels} setLevel={live.setLevel} clear={live.clearLogs} /></Suspense></ErrorBoundary></TabsContent>
        </Tabs>

        <Footer version={overview.box.version} />
      </main>

      {live.expired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="max-w-sm space-y-4 rounded-lg border bg-card p-6 text-center shadow-lg">
            <h2 className="text-lg font-semibold">{renewing ? 'Reconnecting…' : 'Session expired'}</h2>
            <p className="text-sm text-muted-foreground">{renewing ? 'The session timed out; a new one is being opened.' : 'The Box closed this session. Start a new one to continue monitoring.'}</p>
            {!renewing && <Button asChild><a href="../">{overview.cc ? 'Back to all nodes' : 'Start a new session'}</a></Button>}
          </div>
        </div>
      )}
    </div>
  )
}

function TabSkeleton() {
  return <div className="space-y-6"><Skeleton className="h-64" /><Skeleton className="h-48" /></div>
}
