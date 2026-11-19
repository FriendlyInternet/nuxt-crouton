/**
 * #2563 — the composed-page Filters block shows no dead view toggles; the Panel is unchanged.
 * Reads the real component sources (the SFCs need the Nuxt UI runtime to mount) and pins the rule:
 * the block passes view-toggles=false, the Panel never does, and every toggle in PanelFilters
 * sits behind the viewToggles flag (default true).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(__dirname, '../app/components', p), 'utf8')
const block = read('Layout/Filters.vue')
const panel = read('Panel.vue')
const filters = read('PanelFilters.vue')

describe('viewToggles', () => {
  it('Filters block turns the view toggles off', () => {
    expect(block).toMatch(/<CroutonBookingsPanelFilters[\s\S]*?:view-toggles="false"/)
  })

  it('Panel keeps the default (never sets view-toggles)', () => {
    const usage = panel.slice(panel.indexOf('<CroutonBookingsPanelFilters'))
    const tag = usage.slice(0, usage.indexOf('/>'))
    expect(tag).not.toMatch(/view-toggles/)
  })

  it('PanelFilters defaults viewToggles to true', () => {
    expect(filters).toMatch(/viewToggles:\s*true/)
  })

  it('Week/Month, Today, fold button, Map, Location cards and cards row are all guarded', () => {
    expect(filters).toMatch(/v-if="viewToggles && showCalendar"/g)
    expect(filters.match(/v-if="viewToggles && showCalendar"/g)?.length).toBe(2)
    expect(filters).toMatch(/v-if="viewToggles"/)
    expect(filters).toMatch(/props\.viewToggles && props\.hasLocationsWithCoordinates/)
    expect(filters).toMatch(/props\.viewToggles && locationItems\.length > 0/)
    expect(filters).toMatch(/v-if="viewToggles && showLocations/)
  })
})
