import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card,CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function Stat({ label, value, hint, icon, className }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <Card className={cn('p-5', className)}>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        {icon && <span className="[&_svg]:size-4">{icon}</span>}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  )
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

export function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '')
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
