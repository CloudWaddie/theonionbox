import { useEffect, useRef, useState } from 'react'
import type { LiveState } from '@/lib/useDashboard'
import { formatTime } from '@/lib/format'
import { Panel } from '@/components/common'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const LEVELS = ['DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR']
const COLOR: Record<string, string> = {
  D: 'text-muted-foreground', I: 'text-chart-3', N: 'text-foreground', W: 'text-warning', E: 'text-destructive',
}
const NAME: Record<string, string> = { D: 'DEBUG', I: 'INFO', N: 'NOTICE', W: 'WARN', E: 'ERROR' }

export function LogsView({ live, setLevel }: { live: LiveState; setLevel: (l: string, on: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [live.logs, follow])

  return (
    <Panel
      title="Messages"
      description="Events from Tor and the Box. DEBUG switches off by itself after 30 seconds."
      action={
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-xs">
          {LEVELS.map((l) => (
            <label key={l} className="flex cursor-pointer items-center gap-2">
              <Switch checked={!!live.levels[l]} onCheckedChange={(on) => setLevel(l, on)} />
              {l.toLowerCase()}
            </label>
          ))}
        </div>
      }
    >
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
        }}
        className="h-[28rem] overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed"
      >
        {live.logs.length === 0 && <div className="text-muted-foreground">No messages yet.</div>}
        {live.logs.map((e, i) => (
          <div key={i} className="flex gap-3 whitespace-pre-wrap break-words">
            <span className="shrink-0 text-muted-foreground">{formatTime(e.s)}</span>
            <span className={cn('w-14 shrink-0 font-semibold', COLOR[e.l] ?? '')}>{e.t === 'b' ? 'BOX' : NAME[e.l] ?? e.l}</span>
            <span className="min-w-0">{e.m}{e.c > 1 && <span className="ml-2 text-muted-foreground">×{e.c}</span>}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}
