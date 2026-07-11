import { describe, it, expect } from 'vitest'
import { evaluateTestPrint } from '../app/utils/test-print-outcome'

// Testprint outcome-reporting (#1506, follow-up to #1391). The button used to
// stop at "queued"; this pure evaluator turns a polled print_jobs row + elapsed
// time into the REAL terminal verdict so the UI can show printed ✓ / failed ✗.
// Status codes (crouton-printing print_jobs): '0'=pending '1'=printing '2'=done '9'=error.
describe('evaluateTestPrint', () => {
  const within = { elapsedMs: 2000, timeoutMs: 60000 }

  it('reports printed when the job reached done (status 2)', () => {
    expect(evaluateTestPrint({ job: { status: '2' }, ...within }))
      .toEqual({ phase: 'printed', settled: true })
  })

  it('reports failed with the spooler message when the job errored (status 9)', () => {
    // The #1506 motivating case: a mistyped IP fails and the spooler records why.
    expect(evaluateTestPrint({ job: { status: '9', errorMessage: 'Printer not responding at 192.158.1.72' }, ...within }))
      .toEqual({ phase: 'failed', settled: true, reason: 'error', errorMessage: 'Printer not responding at 192.158.1.72' })
  })

  it('failed error message is null when the errored job carries none', () => {
    expect(evaluateTestPrint({ job: { status: '9' }, ...within }))
      .toMatchObject({ phase: 'failed', reason: 'error', errorMessage: null })
  })

  it('keeps polling (pending, not settled) while the job is queued (status 0)', () => {
    expect(evaluateTestPrint({ job: { status: '0' }, ...within }))
      .toEqual({ phase: 'pending', settled: false })
  })

  it('keeps polling while the job is printing (status 1)', () => {
    expect(evaluateTestPrint({ job: { status: '1' }, ...within }))
      .toMatchObject({ phase: 'pending', settled: false })
  })

  it('treats a not-yet-visible job (null) as pending', () => {
    expect(evaluateTestPrint({ job: null, ...within }))
      .toEqual({ phase: 'pending', settled: false })
  })

  it('gives up as a timeout failure when a pending job outlasts the timeout (spooler down / unreachable printer)', () => {
    expect(evaluateTestPrint({ job: { status: '0' }, elapsedMs: 60000, timeoutMs: 60000 }))
      .toEqual({ phase: 'failed', settled: true, reason: 'timeout', errorMessage: null })
  })

  it('a terminal status wins even past the timeout (a done job is printed, not a timeout)', () => {
    expect(evaluateTestPrint({ job: { status: '2' }, elapsedMs: 99000, timeoutMs: 60000 }))
      .toMatchObject({ phase: 'printed', settled: true })
  })
})
