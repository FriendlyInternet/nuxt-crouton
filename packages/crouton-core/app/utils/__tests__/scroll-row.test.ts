/**
 * #4330 — tab rows scroll sideways only. SCROLL_ROW_X must stop the vertical drag
 * (overflow-y-hidden next to overflow-x-auto), and every tab list that had the bug
 * must use it. The components are read as text (same style as
 * booking-create-card-template.test.ts); the real browser check lives in #4386.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SCROLL_ROW_X } from '../scroll-row'

const packagesDir = resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(resolve(packagesDir, rel), 'utf8')

describe('SCROLL_ROW_X', () => {
  it('scrolls sideways and never up and down', () => {
    const classes = SCROLL_ROW_X.split(/\s+/)
    expect(classes).toContain('overflow-x-auto')
    expect(classes).toContain('overflow-y-hidden')
  })
})

describe('tab lists use SCROLL_ROW_X', () => {
  it('BookingCreateCard.vue passes it as the UTabs list class', () => {
    const source = read('crouton-bookings/app/components/BookingCreateCard.vue')
    expect(source).toMatch(/:ui="\{\s*list:\s*SCROLL_ROW_X\b/)
  })

  it('TabsPanel.vue binds it on the tab row', () => {
    const source = read('crouton-core/app/components/TabsPanel.vue')
    expect(source).toMatch(/:class="SCROLL_ROW_X"/)
  })

  it('Client/CategoryTabs.vue uses it for both the UTabs list and the sortable row', () => {
    const source = read('crouton-sales/app/components/Client/CategoryTabs.vue')
    expect(source).toMatch(/:ui="\{\s*list:\s*SCROLL_ROW_X\b/)
    expect(source).toMatch(/:class="SCROLL_ROW_X"/)
  })
})
