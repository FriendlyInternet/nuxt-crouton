import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registryKeyFor, writeDefaultLayout } from '../../lib/compose-layout.ts'

const tmpDirs: string[] = []
function makeDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'crouton-layout-'))
  tmpDirs.push(d)
  return d
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('registryKeyFor', () => {
  it('matches the generated composable/config key (layerCamel + PascalPlural)', () => {
    expect(registryKeyFor('bookings', 'booking')).toBe('bookingsBookings')
    expect(registryKeyFor('shop', 'category')).toBe('shopCategories')
    expect(registryKeyFor('my-layer', 'item')).toBe('myLayerItems')
  })
})

describe('writeDefaultLayout', () => {
  it('composes calendar-primary when the bookings package is in play', async () => {
    const dir = makeDir()
    const r = await writeDefaultLayout({
      cwd: dir,
      features: { bookings: true },
      allCollections: [{ name: 'booking', layer: 'bookings' }],
    })
    expect(r.written).toBe(true)
    expect(r.pattern).toBe('calendar-primary')
    expect(r.viable).toBe(true)

    const file = join(dir, 'crouton.layout.json')
    expect(existsSync(file)).toBe(true)
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    expect(payload.id).toBe('default')
    expect(payload.tree.renderer).toBe('panes')
    // The calendar block is placed and data-binding config is present somewhere in the tree.
    const json = JSON.stringify(payload.tree)
    expect(json).toContain('bookings-calendar')
    expect(json).toContain('bookingsBookings')
  })

  it('composes master-detail for a plain collection (no bookings)', async () => {
    const dir = makeDir()
    const r = await writeDefaultLayout({
      cwd: dir,
      features: {},
      allCollections: [{ name: 'item', layer: 'main' }],
    })
    expect(r.pattern).toBe('master-detail')
    expect(r.viable).toBe(true)
    const payload = JSON.parse(readFileSync(join(dir, 'crouton.layout.json'), 'utf8'))
    const json = JSON.stringify(payload.tree)
    expect(json).toContain('collection-list')
    expect(json).toContain('entity-form')
    expect(json).toContain('mainItems')
  })

  it('does not write on dry-run and skips when there are no collections', async () => {
    const dir = makeDir()
    const dry = await writeDefaultLayout({ cwd: dir, allCollections: [{ name: 'item', layer: 'main' }], dryRun: true })
    expect(dry.written).toBe(false)
    expect(dry.pattern).toBe('master-detail')
    expect(existsSync(join(dir, 'crouton.layout.json'))).toBe(false)

    const none = await writeDefaultLayout({ cwd: dir, allCollections: [] })
    expect(none.written).toBe(false)
    expect(none.reason).toBe('no-collections')
  })
})
