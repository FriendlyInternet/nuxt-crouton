import { describe, it, expect } from 'vitest'
import { parseProductPaste } from '../app/utils/parse-product-paste'
import { planProductImport, buildProductValues, indexByTitle, readImportRequest, nextOrderAfter } from '../server/utils/plan-product-import'

/**
 * Pure planning for the bulk product import (#1656, epic #1652).
 *
 * These assert the SERVER's decisions, which are deliberately not the client's: the
 * endpoint re-parses the raw paste and plans from that, so a stale or tampered payload
 * can't smuggle a row past the rules. The parser's own contract lives in
 * `parse-product-paste.test.ts`; here we feed it real pasted text and check what the
 * import would write.
 */

/** The epic's messy Armonia fixture: 4 good rows, 1 nameless, 1 with an unreadable price. */
const messyPaste = [
  'Name\tPrice\tCategory\tLocation',
  'Pils\t3\tDrank\tBar',
  'Leffe blond\t4\tDrank\tbar',
  'Gin\t8,00\tDrank\tBar',
  'Fles cava\t€ 18\tDrank\tBar',
  '\t5\tDrank\tBar',
  'Kriek\tabc\tDrank\tBar',
].join('\n')

const plan = (paste: string, opts: {
  optIn?: number[]
  products?: string[]
  categories?: { id: string, title: string }[]
  locations?: { id: string, title: string }[]
} = {}) => {
  const parsed = parseProductPaste(paste, {
    existingProductTitles: opts.products ?? [],
    existingCategoryTitles: (opts.categories ?? []).map(c => c.title),
    existingLocationTitles: (opts.locations ?? []).map(l => l.title),
  })
  return planProductImport({
    rows: parsed.rows,
    relationsToCreate: parsed.relationsToCreate,
    optIn: new Set(opts.optIn ?? []),
    existingCategories: opts.categories ?? [],
    existingLocations: opts.locations ?? [],
  })
}

describe('planProductImport — the messy fixture', () => {
  it('imports the 4 good rows and reports the 2 bad ones', () => {
    const p = plan(messyPaste)
    expect(p.toCreate.map(r => r.title)).toEqual(['Pils', 'Leffe blond', 'Gin', 'Fles cava'])
    expect(p.errors).toEqual([
      { rowIndex: 5, message: 'Missing product name' },
      { rowIndex: 6, message: 'Unreadable price' },
    ])
    expect(p.skipped).toBe(0)
  })

  it('creates each missing relation once, case-insensitively (Bar == bar)', () => {
    const p = plan(messyPaste)
    expect(p.newCategoryTitles).toEqual(['Drank'])
    expect(p.newLocationTitles).toEqual(['Bar'])
  })

  it('creates nothing when the relations already exist', () => {
    const p = plan(messyPaste, {
      categories: [{ id: 'c1', title: 'Drank' }],
      locations: [{ id: 'l1', title: 'bar' }], // different casing on purpose
    })
    expect(p.newCategoryTitles).toEqual([])
    expect(p.newLocationTitles).toEqual([])
  })
})

describe('planProductImport — duplicates', () => {
  it('skips a duplicate by default and writes nothing for it', () => {
    const p = plan(messyPaste, { products: ['Pils'] })
    expect(p.skipped).toBe(1)
    expect(p.toCreate.map(r => r.title)).not.toContain('Pils')
  })

  it('writes a duplicate the user explicitly opted into', () => {
    const p = plan(messyPaste, { products: ['Pils'], optIn: [1] })
    expect(p.skipped).toBe(0)
    expect(p.toCreate.map(r => r.title)).toContain('Pils')
  })

  it('an opt-in for a DIFFERENT row does not rescue this one', () => {
    const p = plan(messyPaste, { products: ['Pils'], optIn: [99] })
    expect(p.skipped).toBe(1)
    expect(p.toCreate.map(r => r.title)).not.toContain('Pils')
  })

  it('re-importing the same paste is a no-op — every row already exists', () => {
    const p = plan(messyPaste, { products: ['Pils', 'Leffe blond', 'Gin', 'Fles cava'] })
    expect(p.toCreate).toHaveLength(0)
    expect(p.skipped).toBe(4)
  })

  it('a duplicate does not drag its relations into the create-list', () => {
    const p = plan('Name\tPrice\tCategory\nPils\t3\tNieuw', { products: ['Pils'] })
    expect(p.newCategoryTitles).toEqual([])
  })
})

describe('buildProductValues', () => {
  const ctx = {
    eventId: 'e1',
    stamp: { teamId: 't1', owner: 'u1', createdBy: 'u1', updatedBy: 'u1' },
    now: new Date('2026-08-03T10:00:00Z'),
    startOrder: 7,
    newId: (() => { let n = 0; return () => `id${++n}` })(),
  }

  it('resolves relations by title and continues the order sequence', () => {
    const p = plan(messyPaste)
    const values = buildProductValues(p.toCreate, {
      categories: indexByTitle([{ id: 'cat-drank', title: 'Drank' }]),
      locations: indexByTitle([{ id: 'loc-bar', title: 'Bar' }]),
    }, ctx)

    expect(values.map(v => v.order)).toEqual([7, 8, 9, 10])
    expect(values.every(v => v.categoryId === 'cat-drank')).toBe(true)
    // 'bar' on the Leffe row must resolve to the same location as 'Bar'.
    expect(values.every(v => v.locationId === 'loc-bar')).toBe(true)
    expect(values.map(v => v.price)).toEqual([3, 4, 8, 18])
    expect(values.every(v => v.eventId === 'e1' && v.teamId === 't1')).toBe(true)
  })

  it('leaves an unresolvable relation null rather than inventing an id', () => {
    const p = plan('Name\tPrice\tCategory\nPils\t3\tGhost')
    const values = buildProductValues(p.toCreate, {
      categories: new Map(), locations: new Map(),
    }, ctx)
    expect(values[0]!.categoryId).toBeNull()
    expect(values[0]!.locationId).toBeNull()
  })

  it('applies the schema defaults for the flags a flat paste omits', () => {
    const p = plan('Name\tPrice\nPils\t3')
    const [v] = buildProductValues(p.toCreate, { categories: new Map(), locations: new Map() }, ctx)
    expect(v).toMatchObject({ isActive: true, requiresRemark: false, remarkPrompt: null, description: null })
  })

  it('honours explicit Active / Requires Remark columns', () => {
    const p = plan('Name\tPrice\tActive\tRequires Remark\nPils\t3\tnee\tja')
    const [v] = buildProductValues(p.toCreate, { categories: new Map(), locations: new Map() }, ctx)
    expect(v).toMatchObject({ isActive: false, requiresRemark: true })
  })
})

describe('readImportRequest — untrusted body normalization', () => {
  it('accepts a real paste and opt-in list', () => {
    const r = readImportRequest({ paste: 'Name\tPrice', createDuplicateRowIndexes: [1, 3] })
    expect(r.paste).toBe('Name\tPrice')
    expect([...r.optIn]).toEqual([1, 3])
  })
  for (const [label, body] of [
    ['missing body', undefined],
    ['no paste field', {}],
    ['blank paste', { paste: '   ' }],
    ['non-string paste', { paste: 42 }],
  ] as const) {
    it(`yields an empty paste for ${label} (handler turns it into a 400)`, () => {
      expect(readImportRequest(body).paste).toBe('')
    })
  }
  it('drops non-integer opt-in entries rather than trusting them', () => {
    const r = readImportRequest({ paste: 'x', createDuplicateRowIndexes: [1, '2', 3.5, null, NaN] })
    expect([...r.optIn]).toEqual([1])
  })
  it('tolerates a non-array opt-in field', () => {
    expect([...readImportRequest({ paste: 'x', createDuplicateRowIndexes: 'all' }).optIn]).toEqual([])
  })
})

describe('nextOrderAfter', () => {
  it('starts an empty event at 0', () => expect(nextOrderAfter([])).toBe(0))
  it('appends after the highest existing order', () => expect(nextOrderAfter([{ maxOrder: 12 }])).toBe(13))
  it('treats a null order as unset', () => expect(nextOrderAfter([{ maxOrder: null }])).toBe(0))
})
