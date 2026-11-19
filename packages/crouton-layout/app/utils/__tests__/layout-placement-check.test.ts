/**
 * #3982 T4 — checkLayoutForPlacement: the gate before an agent's layout lands
 * in a live page. Bad JSON / unknown blocks / not viable at 1280 are errors;
 * not fitting 768 / 375 is only a warning.
 */
import { describe, it, expect } from 'vitest'
import { checkLayoutForPlacement } from '../layout-placement-check'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'

const block = (id: string, minWidth: number) => ({ id, name: id, description: '', icon: 'i-lucide-box', component: 'X', minWidth })
const registry: CroutonLayoutBlockRegistry = {
  'calendar': block('calendar', 500),
  'bookings-list': block('bookings-list', 320),
  'wide': block('wide', 900)
}

const side = (a: string, b: string) => ({
  renderer: 'panes',
  root: { type: 'split', direction: 'horizontal', children: [
    { type: 'leaf', blockId: a, defaultSize: 50 },
    { type: 'leaf', blockId: b, defaultSize: 50 }
  ] }
})

// covers: T4
describe('checkLayoutForPlacement', () => {
  it('rejects input that is not a layout (bad JSON string, wrong shape)', () => {
    expect(checkLayoutForPlacement('{not json', registry)).toMatchObject({ ok: false, errors: ['not a valid layout'] })
    expect(checkLayoutForPlacement({ hello: 'world' }, registry)).toMatchObject({ ok: false, errors: ['not a valid layout'] })
  })

  it('rejects a leaf whose block id is not registered, naming it', () => {
    const res = checkLayoutForPlacement(side('calendar', 'nope'), registry)
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toContain('nope')
  })

  it('rejects a tree that is not viable at 1280', () => {
    // wide gets 640 < 900 at 1280
    const res = checkLayoutForPlacement(side('wide', 'bookings-list'), registry)
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/1280.*wide 640<900/)
  })

  it('accepts calendar beside bookings at 1280 and only warns at 768 / 375', () => {
    const res = checkLayoutForPlacement(JSON.stringify(side('calendar', 'bookings-list')), registry)
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])
    expect(res.tree?.root).toMatchObject({ type: 'split' })
    expect(res.warnings).toHaveLength(2)
    expect(res.warnings[0]).toMatch(/768/)
    expect(res.warnings[1]).toMatch(/375/)
  })

  it('a tree that fits everywhere has no warnings', () => {
    const res = checkLayoutForPlacement({ renderer: 'panes', root: { type: 'leaf', blockId: 'bookings-list' } }, registry)
    expect(res).toMatchObject({ ok: true, errors: [], warnings: [] })
  })
})
