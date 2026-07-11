import { describe, it, expect } from 'vitest'
import { buildTestReceipt, buildTestPrintJob } from '../server/utils/test-print'

// The Testprint button's ticket (#1391): a tiny receipt that proves the whole
// chain (routing → transport → paper) without being an order. Pure builder —
// the endpoint feeds it to encodeTicket + enqueuePrintJob.
describe('buildTestReceipt', () => {
  const base = {
    printerTitle: 'Keuken',
    eventName: 'Vlaamse Kermis',
    teamName: 'Test 1',
    requestedBy: 'Claude Verify',
    now: new Date('2026-07-11T10:00:00Z')
  }

  it('builds a valid kitchen-style ReceiptData naming the printer under test', () => {
    const r = buildTestReceipt(base)
    expect(r.printMode).toBe('kitchen') // kitchen layout: big header, no footer text
    expect(r.orderId).toBe('test-print')
    expect(r.clientName).toContain('TESTPRINT') // big centered header on kitchen tickets
    expect(r.items).toHaveLength(1)
    expect(r.items[0].name).toContain('Keuken') // names the printer so multi-printer tests are tellable-apart
    expect(r.showPrices).toBe(false) // a probe has no prices
    expect(r.createdAt).toEqual(base.now)
    expect(r.helperName).toBe('Claude Verify')
    expect(r.eventName).toBe('Vlaamse Kermis')
  })

  it('is deterministic for the same inputs (idempotent re-tests)', () => {
    expect(buildTestReceipt(base)).toEqual(buildTestReceipt(base))
  })

  it('defaults the timestamp when not provided', () => {
    const r = buildTestReceipt({ ...base, now: undefined })
    expect(r.createdAt).toBeInstanceOf(Date)
  })
})

describe('buildTestPrintJob', () => {
  const printer = { id: 'p1', title: 'Keuken', ipAddress: '192.168.1.70', port: 9100, driver: null }
  const ctx = { eventId: 'e1', teamId: 't1', teamName: 'Test 1', eventName: 'Kermis', user: { name: 'Claude Verify', email: 'c@v' } }

  it('assembles the enqueue input with the denormalized printer transport fields', () => {
    const { job } = buildTestPrintJob(printer, ctx)
    expect(job).toMatchObject({
      source: 'sales',
      printerId: 'p1',
      printerIp: '192.168.1.70',
      printerPort: 9100,
      printerTitle: 'Keuken',
      driver: 'network-escpos', // null driver = the thermal default
      refType: 'test',          // order auto-complete reactions skip non-'order'
      refId: 'p1',
      eventId: 'e1',
      teamId: 't1'
    })
  })

  it('coalesces nullable printer columns and coerces the port', () => {
    const { job } = buildTestPrintJob({ id: 'p2', title: null, ipAddress: null, port: '9100', driver: 'browser-print' }, ctx)
    expect(job.printerIp).toBeNull()
    expect(job.printerTitle).toBeNull()
    expect(job.printerPort).toBe(9100)
    expect(job.driver).toBe('browser-print')
  })

  it('threads the presser and event into the ticket (email fallback for the helper line)', () => {
    const { receipt } = buildTestPrintJob(printer, { ...ctx, user: { name: null, email: 'c@v' } })
    expect(receipt.helperName).toBe('c@v')
    expect(receipt.eventName).toBe('Kermis')
    expect(receipt.items[0].name).toContain('Keuken')
  })
})
