import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card,CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function Stat({ label, value, hint, icon, chart, className }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; chart?: ReactNode; className?: string }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="p-5">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{label}</span>
          {icon && <span className="[&_svg]:size-4">{icon}</span>}
        </div>
        <div className="mt-2 truncate font-mono text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
        {hint && <div className="mt-1 truncate text-xs text-muted-foreground">{hint}</div>}
      </div>
      {chart}
    </Card>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

/** Copies a value to the clipboard; falls back to a selection where the clipboard API is not available (plain http). */
export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value)
      else {
        const area = document.createElement('textarea')
        area.value = value
        area.style.cssText = 'position:fixed;opacity:0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        if (!ok) return
      }
      setDone(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setDone(false), 1500)
    } catch { /* the user can still select the text */ }
  }

  return (
    <button type="button" onClick={copy} title={done ? 'Copied' : label} aria-label={label}
      className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  )
}

export function Meter({ value, max = 100, className, barClassName = 'bg-primary' }: { value: number; max?: number; className?: string; barClassName?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', barClassName)} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** A broken panel must not take the whole page down with it. */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: (error: Error, retry: () => void) => ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  retry = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.retry)
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center text-sm">
        <p className="font-medium">This part of the page could not be shown.</p>
        <p className="max-w-md break-words text-xs text-muted-foreground">{error.message}</p>
        <button type="button" onClick={this.retry} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">Try again</button>
      </div>
    )
  }
}

export function Panel({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action && <div className="max-w-full overflow-x-auto">{action}</div>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function KeyValues({ rows, empty }: { rows: [string, ReactNode][]; empty?: ReactNode }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false)
  if (!shown.length) return empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null
  return (
    <dl className="divide-y text-sm">
      {shown.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[9rem_1fr] gap-4 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[12rem_1fr]">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

type Role = { label: string; hint: string; variant: 'default' | 'success' | 'warning' | 'secondary' }

/** Derive what a node does in the Tor network from its mode and consensus flags. */
export function nodeRoles(mode?: string | null, flags?: string[] | null): Role[] {
  if (mode === 'Bridge') return [{ label: 'Bridge', hint: 'Unlisted entry point for censored users', variant: 'warning' }]
  if (mode === 'Snowflake') return [{ label: 'Snowflake', hint: 'Snowflake proxy: helps censored users reach Tor', variant: 'default' }]
  if (mode === 'Client') return [{ label: 'Client', hint: 'Not relaying traffic for others', variant: 'secondary' }]
  if (mode !== 'Relay') return []
  const f = flags ?? []
  const roles: Role[] = []
  if (f.includes('Guard')) roles.push({ label: 'Guard', hint: 'Entry node: first hop of client circuits', variant: 'success' })
  if (f.includes('Exit') && !f.includes('BadExit')) roles.push({ label: 'Exit', hint: 'Exit node: traffic leaves the Tor network here', variant: 'warning' })
  if (!roles.length) roles.push({ label: 'Middle relay', hint: f.length ? 'Relays traffic between other relays' : 'Relay; flags not assigned yet', variant: 'secondary' })
  return [{ label: 'Relay', hint: 'Public relay', variant: 'default' }, ...roles]
}

export function RoleBadges({ mode, flags, className }: { mode?: string | null; flags?: string[] | null; className?: string }) {
  const roles = nodeRoles(mode, flags)
  if (!roles.length) return null
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {roles.map((r) => <Badge key={r.label} variant={r.variant} title={r.hint}>{r.label}</Badge>)}
    </div>
  )
}

/** Blurs sensitive text (e.g. a bridge's IP) until hovered, focused or tapped. */
export function Blur({ on = true, children, className }: { on?: boolean; children: ReactNode; className?: string }) {
  if (!on) return <>{children}</>
  return <span tabIndex={0} className={cn('cursor-default select-none blur-sm transition-[filter] hover:blur-none focus:blur-none', className)}>{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{children}</div>
}
