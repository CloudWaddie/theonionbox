import type { ReactNode } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { Button } from '@/components/ui/button'

export function Logo({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="14" fill="currentColor" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="hsl(var(--background))" strokeWidth="2" />
      <circle cx="16" cy="16" r="4" fill="none" stroke="hsl(var(--background))" strokeWidth="2" />
    </svg>
  )
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const next = { light: 'dark', dark: 'system', system: 'light' } as const
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(next[theme])} title={`Theme: ${theme} (click to change)`} aria-label={`Theme: ${theme}`}>
      <Icon />
    </Button>
  )
}

export function TopBar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="container flex h-14 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          <span className="font-semibold tracking-tight">The Onion Box</span>
          {children}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

export function Footer({ version }: { version: string }) {
  return (
    <footer className="mt-12 flex flex-wrap items-center justify-between gap-2 border-t pt-6 text-xs text-muted-foreground">
      <span>The Onion Box {version}</span>
      <a className="underline-offset-4 hover:underline" href="https://github.com/cloudwaddie/theonionbox" target="_blank" rel="noreferrer">Source on GitHub · MIT licensed</a>
    </footer>
  )
}

// login + error pages
export function CenterCard({ children, version }: { children: ReactNode; version?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2.5 text-lg font-semibold tracking-tight"><Logo className="size-7" />The Onion Box</div>
      <div className="w-full max-w-sm rounded-xl border bg-card p-7 shadow-sm">{children}</div>
      <div className="absolute right-3 top-3"><ThemeToggle /></div>
      {version && <p className="text-xs text-muted-foreground">v{version} · <a className="underline-offset-4 hover:underline" href="https://github.com/cloudwaddie/theonionbox" target="_blank" rel="noreferrer">GitHub</a></p>}
    </div>
  )
}
