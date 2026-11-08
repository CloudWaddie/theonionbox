import { TriangleAlert } from 'lucide-react'
import { CenterCard } from '@/components/shell'
import { Button } from '@/components/ui/button'

export function ErrorView({ message, version }: { message: string; version?: string }) {
  return (
    <CenterCard version={version}>
      <div className="mb-3 flex size-9 items-center justify-center rounded-full bg-destructive/10 text-destructive"><TriangleAlert className="size-5" /></div>
      <h1 className="text-xl font-semibold tracking-tight">Connection error</h1>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">The Onion Box could not connect to Tor.</p>
      <pre className="whitespace-pre-wrap break-words rounded-md border border-destructive/30 bg-destructive/10 p-3 font-mono text-xs text-destructive">{message}</pre>
      <p className="mt-4 text-sm text-muted-foreground">Check that Tor is running and its ControlPort is reachable, then try again.</p>
      <Button className="mt-4 w-full" variant="outline" onClick={() => location.assign('../')}>Try again</Button>
    </CenterCard>
  )
}
