import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Download, Search, Trash2 } from 'lucide-react'
import type { LogEntry } from '@/lib/useDashboard'
import { formatTime } from '@/lib/format'
import { Panel } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const LEVELS = ['DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR']
const COLOR: Record<string, string> = {
  D: 'text-muted-foreground', I: 'text-chart-3', N: 'text-foreground', W: 'text-warning', E: 'text-destructive',
}
const NAME: Record<string, string> = { D: 'DEBUG', I: 'INFO', N: 'NOTICE', W: 'WARN', E: 'ERROR' }
const tag = (e: LogEntry) => (e.t === 'b' ? 'BOX' : NAME[e.l] ?? e.l)

// a line never changes once it is there: no need to render it again with every poll
const Line = memo(function Line({ e }: { e: LogEntry }) {
  return (
    <div className={cn('flex gap-3 whitespace-pre-wrap break-words rounded px-1', e.l === 'E' && 'bg-destructive/5', e.l === 'W' && 'bg-warning/5')}>
      <span className="shrink-0 text-muted-foreground" title={new Date(e.s).toLocaleString()}>{formatTime(e.s)}</span>
      <span className={cn('w-14 shrink-0 font-semibold', COLOR[e.l] ?? '')}>{tag(e)}</span>
      <span className="min-w-0">{e.m}{e.c > 1 && <span className="ml-2 text-muted-foreground">×{e.c}</span>}</span>
    </div>
  )
})

function save(lines: LogEntry[]) {
  const text = lines.map((e) => `${new Date(e.s).toISOString()} ${tag(e).padEnd(6)} ${e.m}${e.c > 1 ? ` (x${e.c})` : ''}`).join('\n')
  const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `tor-messages-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function LogsView({ logs, levels, setLevel, clear }: { logs: LogEntry[]; levels: Record<string, boolean>; setLevel: (l: string, on: boolean) => void; clear: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? logs.filter((e) => e.m.toLowerCase().includes(needle) || tag(e).toLowerCase().includes(needle)) : logs
  }, [logs, q])

  const counts = useMemo(() => {
    let warnings = 0, errors = 0
    for (const e of logs) { if (e.l === 'W') warnings++; else if (e.l === 'E') errors++ }
    return { warnings, errors }
  }, [logs])

  const toEnd = () => { if (box.current) box.current.scrollTop = box.current.scrollHeight }
  useEffect(() => { if (follow) toEnd() }, [shown, follow])

  return (
    <Panel
      title="Messages"
      description={<>Events from Tor and the Box. DEBUG switches off by itself after 30 seconds.</>}
      action={
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-xs">
          {LEVELS.map((l) => (
            <label key={l} className="flex cursor-pointer items-center gap-2">
              <Switch checked={!!levels[l]} onCheckedChange={(on) => setLevel(l, on)} />
              {l.toLowerCase()}
            </label>
          ))}
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative block min-w-40 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input type="search" aria-label="Filter messages" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter messages…" className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
        </label>
        <span className="mr-auto text-xs tabular-nums text-muted-foreground">
          {q.trim() ? `${shown.length} of ${logs.length}` : logs.length} message{logs.length === 1 ? '' : 's'}
          {counts.warnings > 0 && <> · <span className="text-warning">{counts.warnings} warning{counts.warnings === 1 ? '' : 's'}</span></>}
          {counts.errors > 0 && <> · <span className="text-destructive">{counts.errors} error{counts.errors === 1 ? '' : 's'}</span></>}
        </span>
        <Button variant="ghost" size="sm" disabled={!shown.length} onClick={() => save(shown)} title="Save the shown messages as a text file"><Download />Save</Button>
        <Button variant="ghost" size="sm" disabled={!logs.length} onClick={clear} title="Empty this list (Tor's own log is not touched)"><Trash2 />Clear</Button>
      </div>
      <div className="relative">
        <div
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget
            const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24
            setFollow((f) => (f === atEnd ? f : atEnd))
          }}
          className="h-[32rem] max-h-[70vh] overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs leading-relaxed"
        >
          {shown.length === 0 && <div className="p-1 text-muted-foreground">{logs.length ? 'No message matches the filter.' : 'No messages yet.'}</div>}
          {shown.map((e) => <Line key={e.id} e={e} />)}
        </div>
        {!follow && (
          <Button size="sm" variant="secondary" className="absolute bottom-3 right-5 shadow-md" onClick={() => { toEnd(); setFollow(true) }}>
            <ArrowDownToLine />Latest
          </Button>
        )}
      </div>
    </Panel>
  )
}
