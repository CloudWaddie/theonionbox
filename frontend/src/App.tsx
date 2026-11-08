import { useEffect, useMemo, useState } from 'react'
import { Activity, FileText, LogOut, Monitor, Moon, Server, Sun, Globe2 } from 'lucide-react'
import type { Overview } from '@/lib/types'
import { fetchOverview, useDashboard } from '@/lib/useDashboard'
import { useTheme } from '@/lib/theme'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { OverviewView } from '@/views/Overview'
import { NetworkView } from '@/views/Network'
import { NodeView } from '@/views/Node'
import { LogsView } from '@/views/Logs'
import { makeMock, mockOverview } from '@/mock'

const isMock = new URLSearchParams(location.search).has('mock')

export default function App() {
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

function Splash() {
  return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Connecting to Tor…</div>
}

function Fatal({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Session unavailable</h1>
      <p className="max-w-md text-sm text-muted-foreground">The Box could not deliver the dashboard ({message}). Your session may have expired.</p>
      <Button asChild><a href="../">Start a new session</a></Button>
    </div>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const next = { light: 'dark', dark: 'system', system: 'light' } as const
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(next[theme])} title={`Theme: ${theme} (click to change)`} aria-label={`Theme: ${theme}`}>
      <Icon />
    </Button>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
      <circle cx="16" cy="16" r="14" fill="currentColor" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="hsl(var(--background))" strokeWidth="2" />
      <circle cx="16" cy="16" r="4" fill="none" stroke="hsl(var(--background))" strokeWidth="2" />
    </svg>
  )
}

function Dashboard({ overview }: { overview: Overview }) {
  const mock = useMemo(() => (isMock ? makeMock() : undefined), [])
  const live = useDashboard(overview, mock)
  const hasNetwork = overview.sections.includes('network') || !!live.ooBw || !!live.ooWeights
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'overview')
  const { header, tor } = overview

  useEffect(() => { history.replaceState(null, '', `#${tab}`) }, [tab])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Logo />
            <span className="hidden font-semibold tracking-tight sm:inline">The Onion Box</span>
            <span className="hidden text-muted-foreground sm:inline">/</span>
            <span className="truncate font-medium">{header.title}</span>
            <Badge variant={live.connected ? 'success' : live.expired ? 'destructive' : 'warning'} className="shrink-0">
              <span className="size-1.5 rounded-full bg-current" />
              {live.connected ? 'Live' : live.expired ? 'Expired' : 'Reconnecting'}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {header.logout && (
              <Button variant="outline" size="sm" asChild><a href="logout.html"><LogOut /> Logout</a></Button>
            )}
          </div>
        </div>
      </header>

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

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-2 border-t pt-6 text-xs text-muted-foreground">
          <span>The Onion Box {overview.box.version}</span>
          <a className="underline-offset-4 hover:underline" href="https://github.com/cloudwaddie/theonionbox" target="_blank" rel="noreferrer">Source on GitHub · MIT licensed</a>
        </footer>
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
