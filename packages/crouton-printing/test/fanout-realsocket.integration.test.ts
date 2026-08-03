import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import http from 'node:http'
import { mkdtempSync, writeFileSync, chmodSync, appendFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

// Real-socket CONFIRMATION of the shell spooler's per-printer fan-out (#1539).
//
// Background: the field "serial" symptom was a deployment gap — the RUT was
// running a build with NO fan-out at all. main's spooler DOES have it. This test
// is the lasting proof that the fan-out on main opens the printers concurrently
// under REAL sockets — with the REAL system `nc` and REAL `curl`, not process
// stubs (which an earlier harness used, so it couldn't have caught a real-`nc`
// serializer even if one existed).
//
// This box can't bind distinct 127.0.0.x loopback IPs without sudo, so a thin
// `nc` wrapper maps each printer IP → a distinct real loopback PORT and execs
// the real /usr/bin/nc. Three real listeners (one per printer) log their accept
// time — the ground truth for concurrent vs serial. (`timeout` is shimmed
// passthrough: macOS ships none; on the RUT it's real BusyBox timeout. The
// concurrency is a property of the shell's `( … ) &`, which is exercised as-is.)
const here = dirname(fileURLToPath(import.meta.url))
const spooler = resolve(here, '../print-server/teltonika-simple-spooler-fast.sh')
const REAL_NC = '/usr/bin/nc'
// Local-only proof: needs a real system `nc` at a known path + real TCP; the CI
// container has neither reliably, and the field test already confirmed concurrency.
const CI_SKIP = !!process.env.CI || !existsSync(REAL_NC)

let work: string | null = null
afterEach(() => { if (work) { rmSync(work, { recursive: true, force: true }); work = null } })

interface Listener { server: net.Server, port: number, ip: string }

function startListener(ip: string, log: string): Promise<Listener> {
  return new Promise((res) => {
    const server = net.createServer((sock) => {
      appendFileSync(log, `${ip} ${Date.now()}\n`)
      sock.on('data', () => {})
      sock.on('error', () => {})
      // Answer a healthy DLE-EOT reply (online, paper present) after a short
      // hold so serial connects would be spaced ≥ this apart.
      setTimeout(() => { try { sock.write(Buffer.from([0x12, 0x12, 0x12])); sock.end() } catch { /* closed */ } }, 500)
    })
    server.listen(0, '127.0.0.1', () => res({ server, port: (server.address() as net.AddressInfo).port, ip }))
  })
}

async function runFanout(parallel: '0' | '1') {
  work = mkdtempSync(join(tmpdir(), 'fanout-rn-'))
  const bin = join(work, 'bin')
  const connLog = join(work, 'connects.log')
  writeFileSync(connLog, '')

  const ips = ['192.168.1.70', '192.168.1.72', '192.168.1.73']
  const listeners = await Promise.all(ips.map(ip => startListener(ip, connLog)))
  // Real curl target: a local HTTP server that 200s every job callback.
  const httpHits: string[] = []
  const httpSrv = http.createServer((req, res) => { httpHits.push(req.url || ''); res.statusCode = 200; res.end('ok') })
  const httpPort: number = await new Promise(r => httpSrv.listen(0, '127.0.0.1', () => r((httpSrv.address() as net.AddressInfo).port)))

  try {
    require('node:fs').mkdirSync(bin, { recursive: true })
    // nc wrapper: `nc <printerIp> <port>` → map the IP to its real loopback port
    // and exec the REAL nc against 127.0.0.1. Keeps production grouping (by IP)
    // untouched while letting three groups reach three real listeners.
    const portFor = Object.fromEntries(listeners.map(l => [l.ip, l.port]))
    writeFileSync(join(bin, 'nc'), `#!/bin/sh
case "$1" in
  192.168.1.70) P=${portFor['192.168.1.70']} ;;
  192.168.1.72) P=${portFor['192.168.1.72']} ;;
  192.168.1.73) P=${portFor['192.168.1.73']} ;;
  *) P=1 ;;
esac
exec ${REAL_NC} 127.0.0.1 "$P"
`)
    writeFileSync(join(bin, 'timeout'), '#!/bin/sh\nshift\nexec "$@"\n') // macOS has no timeout
    for (const c of ['nc', 'timeout']) chmodSync(join(bin, c), 0o755)

    const runner = join(work, 'run.sh')
    writeFileSync(runner, `#!/bin/sh
set -u
SPOOLER_LIB=1; export SPOOLER_LIB
DEVICE_ID=t; DEVICE_CODE=0; STATUS_CHECK=1
API_URL="http://127.0.0.1:${httpPort}"
PARALLEL_DRAIN="${parallel}"
. "${spooler}"
RESPONSE='{"jobs":[{"id":"j1","printData":"VEVTVA==","printerIp":"192.168.1.70"},{"id":"j2","printData":"VEVTVA==","printerIp":"192.168.1.72"},{"id":"j3","printData":"VEVTVA==","printerIp":"192.168.1.73"}]}'
JOBLIST="${work}/jl"
printf 'j1\\nj2\\nj3\\n' > "$JOBLIST"
group_jobs_by_printer
fan_out_drain
`)
    chmodSync(runner, 0o755)

    // MUST be async spawn (not execFileSync): the listeners run in THIS process;
    // a synchronous exec would block the event loop so nothing could be accepted.
    await new Promise<void>((res, rej) => {
      const child = spawn('sh', [runner], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        stdio: 'ignore'
      })
      const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('fan-out runner timed out')) }, 40_000)
      child.on('exit', () => { clearTimeout(t); res() })
      child.on('error', (e) => { clearTimeout(t); rej(e) })
    })
  }
  finally {
    listeners.forEach(l => l.server.close())
    httpSrv.close()
  }

  // First connect PER listener (the pre-flight connect) → concurrency spread.
  const firstByIp = new Map<string, number>()
  for (const line of require('node:fs').readFileSync(connLog, 'utf8').trim().split('\n').filter(Boolean)) {
    const [ip, ts] = line.split(' ')
    if (!firstByIp.has(ip)) firstByIp.set(ip, Number(ts))
  }
  const firsts = [...firstByIp.values()].sort((a, b) => a - b)
  const spread = firsts.length >= 2 ? firsts[firsts.length - 1] - firsts[0] : 0
  return { spread, printersConnected: firstByIp.size, httpHits: httpHits.length }
}

describe.skipIf(CI_SKIP)('fan_out_drain over REAL loopback TCP + real nc/curl (#1539 confirmation)', () => {
  it('opens the 3 printers CONCURRENTLY (=1) vs SERIALLY (=0) — real nc/curl', async () => {
    // Both modes back-to-back on the same machine, then compare by RATIO so the
    // result is immune to CPU contention from the parallel test suite (absolute
    // ms thresholds flaked; a ratio does not — both spreads scale with load).
    const parallel = await runFanout('1')
    const serial = await runFanout('0')

    // Both reach all three real listeners; real curl completion callbacks fire.
    expect(parallel.printersConnected).toBe(3)
    expect(serial.printersConnected).toBe(3)
    expect(parallel.httpHits).toBeGreaterThanOrEqual(3)

    // Serial waits a full job-cycle per printer (~4s across three) — an absolute
    // floor so a degenerate "everything instant" can't masquerade as a result.
    expect(serial.spread).toBeGreaterThanOrEqual(1500)
    // Concurrent opens all three within a small fraction of that span. This is
    // THE proof: the fan-out overlaps the printers under real sockets.
    expect(parallel.spread * 2).toBeLessThan(serial.spread)
  }, 90_000)
})
