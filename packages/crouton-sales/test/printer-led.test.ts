/**
 * Printer online-LED attribution — behaviour contract (#1507, test-first gate #774).
 *
 * The settings-card LED must light **red** for a printer whose latest print job
 * failed. It went **grey** ("never printed") at a live venue while Bar's jobs
 * were failing every time — because the LED attributes a job to a printer row by
 * `printerId` only, and any drift between a failing job's stored `printerId` and
 * the printer row's current `id` (a printer deleted + re-created with a new
 * nanoid, a regenerated printers collection, jobs enqueued before the row
 * existed) leaves the printer with zero id-matched jobs → grey.
 *
 * Every job row already denormalizes `printerTitle` (written by every enqueue
 * site), so the contract is: attribute by `id` FIRST, else by an **unambiguous**
 * `printerTitle`. Ambiguous (duplicate-title) or truly-absent → grey, never a
 * guess.
 *
 * `attributePrinterStates(printers, jobs)` is the pure core; the Vue component
 * only maps the returned state → dot class + i18n label.
 */
import { describe, it, expect } from 'vitest'
import {
  attributePrinterStates,
  type LedJob,
  type LedPrinter
} from '../app/utils/printer-led'

const printer = (id: string, title: string): LedPrinter => ({ id, title })

const job = (over: Partial<LedJob>): LedJob => ({
  printerId: 'x',
  printerTitle: null,
  status: '2',
  createdAt: 1000,
  completedAt: null,
  ...over
})

const stateOf = (printers: LedPrinter[], jobs: LedJob[], id: string) =>
  attributePrinterStates(printers, jobs).get(id)

describe('attributePrinterStates', () => {
  it('lights red when the latest id-matched job failed', () => {
    const printers = [printer('bar', 'Bar')]
    const jobs = [job({ printerId: 'bar', printerTitle: 'Bar', status: '9', createdAt: 2000 })]
    expect(stateOf(printers, jobs, 'bar')).toBe('offline')
  })

  it('lights green when the latest id-matched job completed', () => {
    const printers = [printer('bar', 'Bar')]
    const jobs = [job({ printerId: 'bar', printerTitle: 'Bar', status: '2', createdAt: 2000 })]
    expect(stateOf(printers, jobs, 'bar')).toBe('online')
  })

  it('pulses (printing) while the latest id-matched job is pending/printing', () => {
    const printers = [printer('bar', 'Bar')]
    const jobs = [job({ printerId: 'bar', printerTitle: 'Bar', status: '0', createdAt: 2000 })]
    expect(stateOf(printers, jobs, 'bar')).toBe('printing')
  })

  it('stays grey (unknown) for a printer that genuinely never printed', () => {
    const printers = [printer('bar', 'Bar')]
    expect(stateOf(printers, [], 'bar')).toBe('unknown')
  })

  // The regression the issue is about: the printer row id drifted away from the
  // jobs (deleted + re-created / regenerated collection), so NO job matches by
  // id — but the failing jobs still carry printerTitle 'Bar'. Must go RED.
  it('falls back to a unique printerTitle when no job matches by id', () => {
    const printers = [printer('bar-new-id', 'Bar')]
    const jobs = [
      job({ printerId: 'bar-old-id', printerTitle: 'Bar', status: '9', createdAt: 2000 })
    ]
    expect(stateOf(printers, jobs, 'bar-new-id')).toBe('offline')
  })

  it('prefers the id match and ignores title-only jobs when any id job exists', () => {
    const printers = [printer('bar', 'Bar')]
    const jobs = [
      // id-matched, newest, completed → should win
      job({ printerId: 'bar', printerTitle: 'Bar', status: '2', createdAt: 3000 }),
      // title-only, older, failed → must NOT override the id match
      job({ printerId: 'stale', printerTitle: 'Bar', status: '9', createdAt: 1000 })
    ]
    expect(stateOf(printers, jobs, 'bar')).toBe('online')
  })

  it('does NOT guess when the title is ambiguous (two printers share it)', () => {
    const printers = [printer('bar-a', 'Bar'), printer('bar-b', 'Bar')]
    const jobs = [
      job({ printerId: 'ghost', printerTitle: 'Bar', status: '9', createdAt: 2000 })
    ]
    // Neither current row can safely claim the orphaned job → both grey.
    expect(stateOf(printers, jobs, 'bar-a')).toBe('unknown')
    expect(stateOf(printers, jobs, 'bar-b')).toBe('unknown')
  })

  it('picks the latest attributed job by completedAt ?? createdAt', () => {
    const printers = [printer('bar', 'Bar')]
    const jobs = [
      job({ printerId: 'bar', printerTitle: 'Bar', status: '9', createdAt: 1000, completedAt: null }),
      // newer, completed (completedAt beats the older failure's createdAt)
      job({ printerId: 'bar', printerTitle: 'Bar', status: '2', createdAt: 1500, completedAt: 2000 })
    ]
    expect(stateOf(printers, jobs, 'bar')).toBe('online')
  })

  it('treats a missing/blank status as pending, not failed', () => {
    const printers = [printer('bar', 'Bar')]
    const jobs = [job({ printerId: 'bar', printerTitle: 'Bar', status: undefined, createdAt: 2000 })]
    expect(stateOf(printers, jobs, 'bar')).toBe('printing')
  })

  it('resolves every printer in one pass (multi-printer map)', () => {
    const printers = [printer('bar', 'Bar'), printer('kitchen', 'Kitchen')]
    const jobs = [
      job({ printerId: 'bar', printerTitle: 'Bar', status: '9', createdAt: 2000 }),
      job({ printerId: 'kitchen', printerTitle: 'Kitchen', status: '2', createdAt: 2000 })
    ]
    const states = attributePrinterStates(printers, jobs)
    expect(states.get('bar')).toBe('offline')
    expect(states.get('kitchen')).toBe('online')
  })
})
