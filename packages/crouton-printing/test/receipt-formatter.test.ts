import { describe, it, expect } from 'vitest'
import { amountLines, formatReceipt, wrapText, type ReceiptData } from '../server/utils/receipt-formatter'
import { encodeTicket } from '../server/utils/print-queue-service'

// Fixed instant + timezone so the rendered time is deterministic and the
// base64 byte stream is stable across machines/CI (CF Workers run in UTC).
const CREATED_AT = '2024-06-18T10:30:00.000Z'
const TIME_ZONE = 'Europe/Brussels'

// A customer receipt exercising accents (é, è), the € sign, options (label +
// price), a boolean option, an item note (→ arrow), staff header + footer.
const customerReceipt: ReceiptData = {
  orderNumber: '42',
  orderId: 'order-42',
  teamName: 'Café Brûlé',
  eventName: 'Vlaamse Kermis',
  clientName: 'Tafel 7',
  helperName: 'Élodie',
  items: [
    {
      name: 'Frietjes',
      quantity: 2,
      price: 3.5,
      notes: 'extra zout',
      options: { Saus: { label: 'Mayonaise', price: 0.5 }, Groot: true }
    },
    { name: 'Pintje', quantity: 3, price: 2.2 }
  ],
  total: 14.6,
  printMode: 'receipt',
  showPrices: true,
  createdAt: CREATED_AT,
  isPersonnel: true,
  timeZone: TIME_ZONE,
  currencySymbol: '€'
}

// A kitchen ticket: big client header, per-location remark, no prices.
const kitchenTicket: ReceiptData = {
  orderNumber: '42',
  orderId: 'order-42',
  teamName: 'Café Brûlé',
  eventName: 'Vlaamse Kermis',
  clientName: 'Tafel 7',
  helperName: 'Élodie',
  locationName: 'Bar',
  locationNote: 'snel aub',
  items: [
    { name: 'Pintje', quantity: 3, options: { Groot: true } }
  ],
  printMode: 'kitchen',
  showPrices: false,
  createdAt: CREATED_AT,
  timeZone: TIME_ZONE
}

describe('formatReceipt — byte-for-byte ESC/POS output', () => {
  it('customer receipt base64 is stable', () => {
    expect(formatReceipt(customerReceipt).base64).toMatchSnapshot()
  })

  it('kitchen ticket base64 is stable', () => {
    expect(formatReceipt(kitchenTicket).base64).toMatchSnapshot()
  })
})

// The price column (#1427): every amount sits flush right at col 48; a long
// label wraps inside its own column instead of displacing the amount.
describe('amountLines — right-aligned price column', () => {
  it('pads a short label so the amount ends at column 48', () => {
    const [line] = amountLines('2× Frietjes', '€7.00')
    expect(line).toHaveLength(48)
    expect(line!.endsWith('€7.00')).toBe(true)
    expect(line!.startsWith(' 2× Frietjes')).toBe(true)
  })

  it('wraps a long label within its column, amount stays on line one', () => {
    const lines = amountLines('1× Huisgemaakte vegetarische lasagne van het huis', '€12.90')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[0]).toHaveLength(48)
    expect(lines[0]!.endsWith('€12.90')).toBe(true)
    // continuation lines carry the hanging indent and no amount
    expect(lines.slice(1).every(l => l.startsWith(' ') && !l.includes('€'))).toBe(true)
  })

  it('indent shifts the label but the amount column stays put', () => {
    const [line] = amountLines('· Groot', '+€0.50', 4)
    expect(line).toHaveLength(48)
    expect(line!.startsWith('    · Groot')).toBe(true)
    expect(line!.endsWith('+€0.50')).toBe(true)
  })
})

describe('wrapText — greedy word wrap', () => {
  it('keeps words whole when they fit', () => {
    expect(wrapText('een twee drie', 8)).toEqual(['een twee', 'drie'])
  })

  it('hard-slices a word longer than the field', () => {
    expect(wrapText('supercalifragilistic', 8)).toEqual(['supercal', 'ifragili', 'stic'])
  })
})

describe('encodeTicket — driver registry', () => {
  it('defaults to network-escpos (base64 ESC/POS)', () => {
    expect(encodeTicket(customerReceipt)).toBe(formatReceipt(customerReceipt).base64)
  })

  it('network-escpos explicit matches formatReceipt base64', () => {
    expect(encodeTicket(customerReceipt, 'network-escpos')).toBe(formatReceipt(customerReceipt).base64)
  })

  it('browser-print stores canonical ReceiptData as JSON', () => {
    expect(encodeTicket(customerReceipt, 'browser-print')).toBe(JSON.stringify(customerReceipt))
  })

  it('unknown driver falls back to the default encoder', () => {
    expect(encodeTicket(customerReceipt, 'serial')).toBe(formatReceipt(customerReceipt).base64)
  })
})
