/**
 * A receipt printer has no location — #1620 decided it, #2292 is the regression.
 *
 * Location is the KITCHEN routing key: a kitchen printer gets the tickets for
 * its location, a receipt printer prints one combined customer ticket and has
 * no location at all (PrinterForm sets it to null). The package once went back
 * to `NOT NULL` + `min(1)` through a squash, so kassa could not save a receipt
 * printer. These pin the two places that decide it: the column and the
 * validation schema. "Kitchen printers need a location" stays the form's job
 * (PrinterForm superRefine), not the schema's.
 */
import { describe, it, expect } from 'vitest'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { salesPrinters } from '../collections/printers/server/database/schema'
import { salesPrinterSchema } from '../collections/printers/app/composables/useSalesPrinters'

const base = { eventId: 'evt', title: 'Kassa', ipAddress: '192.168.1.20', type: 'receipt' }

describe('printer location is optional (#2292)', () => {
  it('the locationId column is nullable', () => {
    const column = getTableConfig(salesPrinters).columns.find(c => c.name === 'locationId')
    expect(column?.notNull).toBe(false)
  })

  it('accepts a receipt printer with locationId null (what the form sends)', () => {
    expect(salesPrinterSchema.safeParse({ ...base, locationId: null }).success).toBe(true)
  })

  it('accepts a receipt printer with no locationId key at all', () => {
    expect(salesPrinterSchema.safeParse(base).success).toBe(true)
  })

  it('still carries a kitchen printer\'s location', () => {
    const parsed = salesPrinterSchema.parse({ ...base, type: 'kitchen', locationId: 'loc_1' })
    expect(parsed.locationId).toBe('loc_1')
  })
})
