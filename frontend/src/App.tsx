import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Activity, FileText, Globe2, LayoutGrid, LogOut, Server } from 'lucide-react'
import type { Overview, PageState } from '@/lib/types'
import { fetchOverview, useDashboard, useHealth } from '@/lib/useDashboard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Footer, TopBar } from '@/components/shell'
import { OverviewView } from '@/views/Overview'

// Everything but the first screen is split into its own chunk and fetched on demand (or ahead, when idle).
const loadNetwork = () => import('@/views/Network').then((m) => ({ default: m.NetworkView }))
const loadNode = () => import('@/views/Node').then((m) => ({ default: m.NodeView }))
const loadLogs = () => import('@/views/Logs').then((m) => ({ default: m.LogsView }))
const NetworkView = lazy(loadNetwork)
const NodeView = lazy(loadNode)
const LogsView = lazy(loadLogs)
const LoginView = lazy(() => import('@/views/Login').then((m) => ({ default: m.LoginView })))
const ErrorView = lazy(() => import('@/views/ErrorPage').then((m) => ({ default: m.ErrorView })))
const ControlCenterView = lazy(() => import('@/views/ControlCenter').then((m) => ({ default: m.ControlCenterView })))
import { installMockApi, makeMock, mockHealth, mockOverview } from '@/mock'

const params = new URLSearchParams(location.search)
const isMock = params.has('mock')
if (isMock) installMockApi()

// Start fetching as soon as the script runs (not after React has mounted), and in parallel.
const statePromise: Promise<PageState> | null = isMock ? null : fetch('api/state', { cache: 'no-store', credentials: 'same-origin' })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
let overviewPromise: Promise<Overview> | null = null
statePromise?.then((s) => { if (s.page !== 'login' && s.page !== 'error' && s.page !== 'cc') overviewPromise = fetchOverview() }).catch(() => {})

export default function App() {
  const [state, setState] = useState<PageState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(statePromise ?? fetch('api/state', { cache: 'no-store', credentials: 'same-origin' }).then((r) => r.json()))
      .then(setState)
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  if (error) return <Fatal message={error} />
  if (!state) return <Splash />

  return (
    <Suspense fallback={<Splash />}>
      {state.page === 'login' ? <LoginView auth={state.auth} proceedTo={state.proceed_to} label={state.label} version={state.box} />
        : state.page === 'error' ? <ErrorView message={state.message} version={state.box} />
        : state.page === 'cc' ? <ControlCenterView version={state.box} logout={state.logout} />
        : <DashboardLoader />}
    </Suspense>
  )
}

function Splash() {
  return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Connecting to Tor…</div>
}

function Fatal({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Session unavailable</h1>
      <p className="max-w-md text-sm text-muted-foreground">The Box could not deliver this page ({message}). Your session may have expired.</p>
      <Button asChild><a href="../">Start a new session</a></Button>
    </div>
  )
}

function DashboardLoader() {
  const [overview, setOverview] = useState<Overview | null>(isMock ? mockOverview : null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isMock) return
    ;(overviewPromise ?? fetchOverview()).then(setOverview).catch((e) => setError(String(e.message ?? e)))
  }, [])

  if (error) return <Fatal message={error} />
  if (!overview) return <Splash />
  return <Dashboard overview={overview} />
}

function Dashboard({ overview }: { overview: Overview }) {
  const mock = useMemo(() => (isMock ? makeMock() : undefined), [])
  const live = useDashboard(overview, mock)
  const health = useHealth(isMock ? mockHealth : undefined)
  const hasNetwork = overview.sections.includes('network') || !!live.ooBw || !!live.ooWeights
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'overview')
  const { header, tor } = overview

  useEffect(() => {
    const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500))
    idle(() => { loadNode(); loadLogs(); loadNetwork() })
  }, [])

  useEffect(() => { history.replaceState(null, "", `${location.pathname}${location.search}#${tab}`) }, [tab])

  return (
    <div className="min-h-screen">
      <TopBar
        actions={
          <>
            {overview.cc && <Button variant="ghost" size="sm" asChild><a href="../"><LayoutGrid />All nodes</a></Button>}
            {header.logout && <Button variant="outline" size="sm" asChild><a href="logout.html"><LogOut /> Logout</a></Button>}
          </>
        }
      >
        <span className="hidden text-muted-foreground sm:inline">/</span>
        <span className="truncate font-medium">{header.title}</span>
        <Badge variant={live.connected ? 'success' : live.expired ? 'destructive' : 'warning'} className="shrink-0">
          <span className="size-1.5 rounded-full bg-current" />
          {live.connected ? 'Live' : live.expired ? 'Expired' : 'Reconnecting'}
        </Badge>
      </TopBar>

      <main className="container py-8">
        <div className="mb-8 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{header.title}</h1>
          <p className="text-sm text-muted-foreground">
            Tor {header.tor_version} · {tor.mode} · {header.location}
            {header.fingerprint && <> · <span className="font-mono text-xs">{header.fingerprint}</span></>}
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview"><Activity className="mr-1.5 size-4" />Overview</TabsTrigger>
            {hasNetwork && <TabsTrigger value="network"><Globe2 className="mr-1.5 size-4" />Network</TabsTrigger>}
            <TabsTrigger value="node"><Server className="mr-1.5 size-4" />Node</TabsTrigger>
            <TabsTrigger value="logs"><FileText className="mr-1.5 size-4" />Messages</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><OverviewView overview={overview} live={live} health={health?.health ?? null} /></TabsContent>
          {hasNetwork && <TabsContent value="network"><Suspense fallback={null}><NetworkView network={overview.network} live={live} /></Suspense></TabsContent>}
          <TabsContent value="node"><Suspense fallback={null}><NodeView overview={overview} bridge={health?.bridge ?? null} /></Suspense></TabsContent>
          <TabsContent value="logs"><Suspense fallback={null}><LogsView live={live} setLevel={live.setLevel} /></Suspense></TabsContent>
        </Tabs>

        <Footer version={overview.box.version} />
      </main>

      {live.expired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="max-w-sm space-y-4 rounded-lg border bg-card p-6 text-center shadow-lg">
            <h2 className="text-lg font-semibold">Session expired</h2>
            <p className="text-sm text-muted-foreground">The Box closed this session. Start a new one to continue monitoring.</p>
            <Button asChild><a href="../">Start a new session</a></Button>
          </div>
        </div>
      )}
    </div>
  )
}
