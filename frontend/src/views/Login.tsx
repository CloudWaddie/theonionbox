import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { login, LoginFailed } from '@/lib/auth'
import { CenterCard } from '@/components/shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const sessionId = () => new URL(document.baseURI).pathname.split('/').filter(Boolean).pop() ?? ''

export function LoginView({ auth, proceedTo, label, version }: { auth: 'digest' | 'basic'; proceedTo: string; label?: string | null; version?: string }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const failedBefore = new URLSearchParams(location.search).has('failed')
  const [error, setError] = useState<string | null>(failedBefore ? 'Wrong password.' : null)
  const insecure = auth === 'basic' && location.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      location.assign(await login(sessionId(), password, auth, proceedTo))
    } catch (err) {
      // Same as before: a failed attempt invalidates the session; the Box hands out a fresh one.
      if (err instanceof LoginFailed || err instanceof TypeError) location.assign('failed.html')
      else setError(String(err))
      setBusy(false)
    }
  }

  return (
    <CenterCard version={version}>
      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        Enter the control password of {label ? <b className="font-medium text-foreground">{label}</b> : 'your Tor node'}.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pw">Password</Label>
          <Input id="pw" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} required />
        </div>
        {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {insecure && <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">This connection is not encrypted: the password is sent in the clear. Use HTTPS.</p>}
        <Button type="submit" className="w-full" disabled={busy || !password}>{busy && <Loader2 className="animate-spin" />}Login</Button>
      </form>
    </CenterCard>
  )
}
