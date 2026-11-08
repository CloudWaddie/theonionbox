import { useEffect, useMemo, useState } from 'react'
import { Activity, FileText, Globe2, LayoutGrid, LogOut, Server } from 'lucide-react'
import type { Overview, PageState } from '@/lib/types'
import { fetchOverview, useDashboard } from '@/lib/useDashboard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Footer, TopBar } from '@/components/shell'
import { OverviewView } from '@/views/Overview'
import { NetworkView } from '@/views/Network'
import { NodeView } from '@/views/Node'
import { LogsView } from '@/views/Logs'
import { LoginView } from '@/views/Login'
import { ErrorView } from '@/views/ErrorPage'
import { ControlCenterView } from '@/views/ControlCenter'
import { installMockApi, makeMock, mockOverview } from '@/mock'

const params = new URLSearchParams(location.search)
const isMock = params.has('mock')
if (isMock) installMockApi()

export default function App() {
  const [state, setState] = useState<PageState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('api/state', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setState)
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  if (error) return <Fatal message={error} />
  if (!state) return <Splash />

  switch (state.page) {
    case 'login': return <LoginView auth={state.auth} proceedTo={state.proceed_to} label={state.label} version={state.box} />
    case 'error': return <ErrorView message={state.message} version={state.box} />
    case 'cc': return <ControlCenterView version={state.box} logout={state.logout} />
    default: return <DashboardLoader />
  }
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
    fetchOverview().then(setOverview).catch((e) => setError(String(e.message ?? e)))
  }, [])

  if (error) return <Fatal message={error} />
  if (!overview) return <Splash />
  return <Dashboard overview={overview} />
}

function Dashboard({ overview }: { overview: Overview }) {
  const mock = useMemo(() => (isMock ? makeMock() : undefined), [])
  const live = useDashboard(overview, mock)
  const hasNetwork = overview.sections.includes('network') || !!live.ooBw || !!live.ooWeights
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'overview')
  const { header, tor } = overview

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
          <TabsContent value="overview"><OverviewView overview={overview} live={live} /></TabsContent>
          {hasNetwork && <TabsContent value="network"><NetworkView network={overview.network} live={live} /></TabsContent>}
          <TabsContent value="node"><NodeView overview={overview} /></TabsContent>
          <TabsContent value="logs"><LogsView live={live} setLevel={live.setLevel} /></TabsContent>
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
