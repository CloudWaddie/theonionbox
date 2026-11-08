import type { History, LiveResponse, Overview } from './lib/types'

/** Demo data for `?mock=1` - lets the UI be developed / screenshotted without a Tor node. */
export const mockOverview: Overview = {
  token: 'mock',
  box: { version: '20.2 (demo)' },
  header: { title: 'demo-relay', location: 'berlin', tor_version: '0.4.9.11', fingerprint: 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678', logout: false },
  sections: ['host', 'config', 'local', 'network', 'accounting', 'monitor', 'transport', 'messages'],
  tor: { version: '0.4.9.11', version_short: '0.4.9.11', version_status: 'recommended', latest_stable: '0.4.9.11', latest_unstable: '0.4.9.11', is_latest_stable: true, is_latest_unstable: true, pid: 812, user: 'debian-tor', nickname: 'demo-relay', mode: 'Relay', fingerprint: 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678', flags: ['Fast', 'Guard', 'Running', 'Stable', 'Valid'], is_localhost: true, hibernating: false },
  host: { name: 'berlin', os: 'Linux 6.8.0', os_version: '#1 SMP', system: 'x86_64', uptime: '2026-10-01 08:12:44', cpu_count: 4, memory_mb: 8192, temperature: true },
  accounting: { enabled: true },
  config: [{ name: 'ORPort', values: ['9001'] }, { name: 'Nickname', values: ['demo-relay'] }, { name: 'RelayBandwidthRate', values: ['5 MBytes'] }, { name: 'ControlPort', values: ['9051'] }],
  hidden_services: [{ dir: '/var/lib/tor/hs', options: { HiddenServicePort: ['80 127.0.0.1:8080'], HiddenServiceVersion: '3' } }],
  network: { type: 'Relay', fingerprint: 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678', nickname: 'demo-relay', platform: 'Tor 0.4.9.11 on Linux', contact: 'ops@example.org', or_addresses: ['203.0.113.7:9001'], exit_addresses: [], dir_address: null, first_seen: '2024-03-02 10:00:00', last_seen: '2026-11-08 04:00:00', last_restarted: '2026-10-01 08:10:00', last_changed: '2025-02-11 12:00:00', running: true, hibernating: false, flags: ['Fast', 'Guard', 'Running', 'Stable', 'Valid'], as_number: 'AS64500', as_name: 'Example Net', host_name: null, published: '2026-11-08 03:00:00', location: { country: 'de', country_name: 'Germany', region: 'Berlin', city: 'Berlin', latitude: 52.52, longitude: 13.4 } },
  intervals: { '1s': 1, '1m': 60, '5m': 300, '1h': 3600, '4h': 14400, Ch: 43200 },
  transport: { or: 41, circ: 128, stream: 211 },
}

let tick = 0
const wave = (t: number, base: number, amp: number, period: number) => Math.max(0, base + amp * Math.sin(t / period) + amp * 0.4 * Math.sin(t / (period / 3.1)) + Math.random() * amp * 0.25)

function history(points: number, stepMs: number, fn: (i: number) => number | null): [number, number | null][] {
  const end = Date.now()
  return Array.from({ length: points }, (_, i) => [end - (points - i) * stepMs, fn(i)])
}

export function makeMock(): () => LiveResponse {
  let first = true
  return () => {
    const now = Date.now()
    const gen = [0, 1].map((k) => {
      const t = now - (1 - k) * 1000
      tick += 1
      const cores = [0, 1, 2, 3].map((c) => wave(tick, 20 + c * 6, 12, 14 + c))
      return { s: t, c: cores.reduce((a, b) => a + b, 0) / 4, c0: cores[0], c1: cores[1], c2: cores[2], c3: cores[3], mp: 38 + Math.sin(tick / 90) * 3, t: 48 + Math.sin(tick / 50) * 4 }
    })
    const mkMon = (n: number, step: number, secs: number) =>
      Array.from({ length: n }, (_, i) => ({ s: now - (n - i) * step, w: wave(i, 600_000, 350_000, 9) * secs, r: -wave(i + 5, 900_000, 450_000, 11) * secs, tw: 1.2e9, tr: 3.4e9 }))
    const d: LiveResponse = { tick: now, token: 'mock', gen, transport: { or: 41, circ: 120 + (tick % 15), stream: 200 + (tick % 20) } }
    d.mon = first
      ? { '1s': mkMon(120, 1000, 1), '1m': mkMon(180, 60_000, 60), '5m': mkMon(200, 300_000, 300), '1h': mkMon(168, 3_600_000, 3600), '4h': mkMon(120, 14_400_000, 14400), Ch: mkMon(90, 43_200_000, 43200) }
      : { '1s': mkMon(2, 1000, 1) }
    if (first) {
      const bw = (pts: number, step: number, base: number): History => ({ d3: history(pts, step, (i) => wave(i, base, base * 0.5, 9)) })
      d.oo_bw = {
        read: { w1: history(168, 3_600_000, (i) => -wave(i, 800_000, 400_000, 12)), m1: history(120, 6 * 3_600_000, (i) => -wave(i, 780_000, 300_000, 8)), ...bw(72, 3_600_000, 700_000) },
        write: { w1: history(168, 3_600_000, (i) => wave(i + 3, 700_000, 350_000, 12)), m1: history(120, 6 * 3_600_000, (i) => wave(i + 2, 680_000, 260_000, 8)), ...bw(72, 3_600_000, 640_000) },
      }
      const frac = (base: number): History => ({ m1: history(120, 6 * 3_600_000, (i) => wave(i, base, base * 0.2, 7)), w1: history(168, 3_600_000, (i) => wave(i, base, base * 0.15, 10)) })
      d.oo_weights = { cw: { m1: history(120, 6 * 3_600_000, (i) => wave(i, 5200, 600, 7)) }, cwf: frac(0.0021), gp: frac(0.0034), mp: frac(0.0009), ep: frac(0.0001), data: { cw: 5300, cwf: 0.0021, gp: 0.0034, mp: 0.0009, ep: 0.0001 } }
      d.acc = { enabled: true, stats: { status: 'awake', read_bytes: 4.2e10, read_limit: 1e11, written_bytes: 3.8e10, write_limit: 1e11, time_until_reset: 3600 * 17 + 600, interval_end: Date.now() / 1000 + 3600 * 17 } }
      d.msg_status = { DEBUG: false, INFO: false, NOTICE: true, WARNING: true, ERROR: true }
      d.msg = [
        { s: now - 5000, l: 'N', m: 'Bootstrapped 100% (done): Done', t: 't', c: 1 },
        { s: now - 4000, l: 'N', m: 'Tor has successfully opened a circuit. Looks like client functionality is working.', t: 't', c: 1 },
        { s: now - 3000, l: 'W', m: 'Your system clock just jumped 2 seconds forward; assuming established circuits no longer work.', t: 't', c: 2 },
        { s: now - 2000, l: 'N', m: 'Session established.', t: 'b', c: 1 },
        { s: now - 1000, l: 'E', m: 'Demo error message to show the styling', t: 't', c: 1 },
      ]
    }
    first = false
    return d
  }
}
