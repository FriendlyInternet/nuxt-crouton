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
    expect(panel.indexOf('<CroutonBookingsPanelFilters')).toBeGreaterThan(-1)
    const usage = panel.slice(panel.indexOf('<CroutonBookingsPanelFilters'))
    const tag = usage.slice(0, usage.indexOf('/>'))
    expect(tag).not.toMatch(/view-toggles/)
  })

  it('PanelFilters defaults viewToggles to true', () => {
    expect(filters).toMatch(/viewToggles:\s*true/)
  })

  // covers: T1 — #4516: the Panel has no Week/Month, Today or fold; the cog row is composed-page only
  it('no Week/Month, Today or fold control; the toolbar row only renders when !viewToggles', () => {
    expect(filters).not.toMatch(/showCalendar|show-calendar/)
    expect(filters).not.toMatch(/calendarView|calendar-view/)
    expect(filters).not.toMatch(/go-to-today/)
    expect(filters).not.toMatch(/toolbar-end/)
    expect(filters).not.toMatch(/UFieldGroup/)
    expect(filters).not.toMatch(/bookings\.filters\.(week|month|today|foldCalendar|unfoldCalendar)/)
    expect(panel).not.toMatch(/showCalendar/)
    // the toolbar row is behind !viewToggles and the cog is inside it
    const row = filters.indexOf('<div v-if="!viewToggles"')
    expect(row).toBeGreaterThan(-1)
    const cog = filters.indexOf('<UDropdownMenu')
    const prompt = filters.indexOf('locations.length === 0 && canManageLocations')
    expect(cog).toBeGreaterThan(row)
    expect(cog).toBeLessThan(prompt)
    // the removed i18n keys are gone from every locale
    for (const lang of ['en', 'nl', 'fr']) {
      const json = JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${lang}.json`), 'utf8'))
      for (const key of ['week', 'month', 'today', 'foldCalendar', 'unfoldCalendar'])
        expect(json.bookings.filters[key]).toBeUndefined()
    }
  })

  // covers: T6 — the admin "no locations yet" prompt keeps working from the Panel
  it('Panel still renders the no-locations prompt for admins, outside the toolbar row', () => {
    const at = panel.indexOf('<CroutonBookingsPanelFilters')
    expect(at).toBeGreaterThan(-1)
    const tag = panel.slice(at, panel.indexOf('/>', at))
    expect(tag).toMatch(/:can-manage-locations="effectiveIsAdmin"/)
    expect(tag).toMatch(/@add-location="onAddLocation"/)
    // its wrapper only renders when there is something to show
    const wrapper = panel.slice(panel.lastIndexOf('<div', at), at)
    expect(wrapper).toMatch(/v-if="[^"]*resolvedLocations\.length === 0[^"]*"/)
    expect(wrapper).toMatch(/v-if="[^"]*effectiveIsAdmin[^"]*"/)
    // PanelFilters keeps the prompt, after (outside) the !viewToggles row
    const prompt = filters.indexOf('v-if="locations.length === 0 && canManageLocations"')
    expect(prompt).toBeGreaterThan(-1)
    expect(filters).toMatch(/emit\('add-location'\)/)
    const rowStart = filters.indexOf('<div v-if="!viewToggles"')
    const rowEnd = filters.indexOf('</UDropdownMenu>', rowStart)
    expect(prompt).toBeGreaterThan(rowEnd)
  })

  // covers: T4 — #4492: Map and Show cancelled moved to the list; the cog only on composed pages
  it('no Map item; the cog (with Show cancelled) only renders when !viewToggles', () => {
    expect(filters).not.toMatch(/bookings\.filters\.map/)
    expect(filters).not.toMatch(/hasLocationsWithCoordinates/)
    expect(filters).not.toMatch(/update:showMap/)
    expect(filters).toMatch(/<div v-if="!viewToggles"[\s\S]*?<UDropdownMenu/)
    expect(filters.match(/<UDropdownMenu/g)?.length).toBe(1)
    expect(filters).toMatch(/showCancelled\?:\s*boolean/)
    expect(filters).toMatch(/showCancelled:\s*false/)
    expect(panel.indexOf('<CroutonBookingsPanelFilters')).toBeGreaterThan(-1)
    const usage = panel.slice(panel.indexOf('<CroutonBookingsPanelFilters'))
    const tag = usage.slice(0, usage.indexOf('>'))
    expect(tag).not.toMatch(/show-cancelled|show-map|has-locations-with-coordinates/)
  })

  // #4471 — location cards and their cog toggle are gone; composed pages get the tab row
  it('no location cards toggle; composed pages keep a location picker', () => {
    expect(filters).not.toMatch(/showLocations/)
    expect(filters).not.toMatch(/locationCards/)
    expect(filters).toMatch(/v-if="!viewToggles && locations\.length > 0"/)
    expect(panel).not.toMatch(/show-locations/)
  })
})
