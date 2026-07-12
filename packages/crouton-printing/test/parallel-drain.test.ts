import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Runs the real BusyBox-ash-compatible harness (print-server/test/
// parallel-drain.harness.sh), which sources the actual spooler as a library and
// drives its real group_jobs_by_printer + fan_out_drain with stubbed
// nc/curl/timeout, feeding one poll RESPONSE containing 3 jobs to 3 DISTINCT
// printer IPs. The stub `nc` records each start second and sleeps 2s, so:
//   PARALLEL_DRAIN=1 → the three pre-flight reads start within ~1s (concurrent)
//   PARALLEL_DRAIN=0 → they start ~2s apart (serial fallback)
// This is the agent-verifiable proof that the per-printer fan-out really does
// overlap different printers — no physical RUT needed (#1539).
const here = dirname(fileURLToPath(import.meta.url))
const harness = resolve(here, '../print-server/test/parallel-drain.harness.sh')

function runHarness(mode: '0' | '1'): { code: number, out: string } {
  try {
    const out = execFileSync('sh', [harness, mode], { encoding: 'utf8', timeout: 60_000 })
    return { code: 0, out }
  }
  catch (err: any) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

describe('spooler parallel per-printer drain (fan-out)', () => {
  it('drains different printers CONCURRENTLY when PARALLEL_DRAIN=1', () => {
    const { code, out } = runHarness('1')
    expect(out).toContain('groups=3')
    expect(out).toMatch(/RESULT: CONCURRENT/)
    expect(code).toBe(0)
  }, 60_000)

  it('falls back to SERIAL when PARALLEL_DRAIN=0 (the opt-out path)', () => {
    const { code, out } = runHarness('0')
    expect(out).toMatch(/RESULT: SERIAL/)
    expect(code).toBe(1)
  }, 60_000)
})
