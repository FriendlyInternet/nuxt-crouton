import { describe, it, expect } from 'vitest'
import { buildTestReceipt } from '../server/utils/test-print'

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
