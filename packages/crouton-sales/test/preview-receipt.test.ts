import { describe, it, expect } from 'vitest'
import { buildPreviewReceipt } from '../server/utils/preview-receipt'

const SETTINGS = {
  special_instructions_title: 'OPMERKING:',
  staff_order_header: '*** PERSONEEL ***',
  footer_text: 'Bedankt!'
}
const CTX = { teamName: 'Test 1', eventName: 'Vlaamse Kermis', currencySymbol: '€', requestedBy: 'Els' }

describe('buildPreviewReceipt', () => {
  it('a kitchen printer previews the kitchen layout with prices + a total', () => {
    const r = buildPreviewReceipt({ title: 'Bar', showPrices: true, type: 'kitchen' }, CTX, SETTINGS)
    expect(r.printMode).toBe('kitchen')
    expect(r.showPrices).toBe(true)
    // total = sum of line prices (options excluded, matching real printing)
    expect(r.total).toBeCloseTo(2.0 + 3.5 * 2 + 1.8 * 2 + 2.5, 5)
    expect(r.isPersonnel).toBe(true)
    expect(r.receiptSettings).toBe(SETTINGS)
  })

  it('a receipt printer previews the receipt layout', () => {
    const r = buildPreviewReceipt({ title: 'Kassa', showPrices: true, type: 'receipt' }, CTX, SETTINGS)
    expect(r.printMode).toBe('receipt')
  })

  it('no prices → no total', () => {
    const r = buildPreviewReceipt({ title: 'Bar', showPrices: false, type: 'kitchen' }, CTX, SETTINGS)
    expect(r.showPrices).toBe(false)
    expect(r.total).toBeUndefined()
  })

  it('null showPrices/type default to prices-on + kitchen', () => {
    const r = buildPreviewReceipt({ title: 'Bar', showPrices: null, type: null }, CTX, SETTINGS)
    expect(r.printMode).toBe('kitchen')
    expect(r.showPrices).toBe(true)
  })

  it('carries a sample note + a detailed item so the settings/spacing show', () => {
    const r = buildPreviewReceipt({ title: 'Bar', showPrices: true, type: 'kitchen' }, CTX, SETTINGS)
    expect(r.orderNotes).toBeTruthy()
    expect(r.items.some(i => i.notes || i.options)).toBe(true)
  })
})
