/**
 * #4111 — Calendar.vue counts slots through `slotMarks` (the product rule) and
 * no longer carries the old slot-capacity / inventory counting or its "Units" line.
 * Reads the real Calendar.vue and the real locale files.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'vue/compiler-sfc'

const file = resolve(__dirname, '../app/components/Calendar.vue')
const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
const script = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? ''
const template = descriptor.template!.content

describe('Calendar.vue — product-rule counting (#4111)', () => {
  // covers: T3
  it('imports slotMarks and drops the old counting names', () => {
    expect(script).toMatch(/import\s*\{\s*slotMarks\s*\}\s*from\s*'\.\.\/utils\/slot-marks'/)
    for (const name of ['slot.capacity', 'inventoryQuantity', 'inventoryBookedCount', 'isInventoryMode']) {
      expect(script, name).not.toContain(name)
    }
  })

  // covers: T4
  it('has no "Units" line in the template or the locales', () => {
    expect(template).not.toContain('bookings.calendar.units')
    for (const locale of ['en', 'nl', 'fr']) {
      const json = JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${locale}.json`), 'utf8'))
      expect(json.bookings?.calendar, locale).toBeTruthy()
      expect(json.bookings.calendar, locale).not.toHaveProperty('units')
    }
  })
})
