import { describe, it, expect } from 'vitest'
import { parseProductPaste } from '../app/utils/parse-product-paste'

/**
 * Test-first contract for the product paste-import parser (#1655, epic #1652).
 *
 * Committed FAILING on purpose (#774): `parseProductPaste` is a throwing stub until
 * these cases are signed off. Behaviour source = the epic's field table + "How to test"
 * fixture (the messy Armonia drinks list). The parser is pure — no UI, no DB, no network.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * OPEN QUESTION FOR SIGN-OFF (the one place the epic is internally ambiguous):
 * The epic lists `warn-creates-relation` as a per-row status, BUT its "How to test"
 * step 4 calls the clean Drank/Bar rows "✅ new" with relation creation shown as a
 * separate ⚠️ banner. These tests follow the How-to-test reading — clean rows are
 * `new`, relation creation lives in `relationsToCreate` — and treat
 * `warn-creates-relation` as reserved (not emitted in v1). If you'd rather a row that
 * triggers a relation creation be `warn-creates-relation` itself, this is the switch.
 * ──────────────────────────────────────────────────────────────────────────────
 */

describe('delimiter detection (tab → semicolon → comma)', () => {
  it('detects tab when any row has a tab', () => {
    expect(parseProductPaste('Name\tPrice\nPils\t3').delimiter).toBe('tab')
  })
  it('falls back to semicolon when there is no tab', () => {
    expect(parseProductPaste('Name;Price\nPils;3').delimiter).toBe('semicolon')
  })
  it('falls back to comma when there is no tab or semicolon', () => {
    expect(parseProductPaste('Name,Price\nPils,3').delimiter).toBe('comma')
  })
})

describe('header mapping (alias, trimmed, case-insensitive)', () => {
  it('maps the Dutch aliases', () => {
    const res = parseProductPaste('Naam\tPrijs\tCategorie\tLocatie\nPils\t3\tDrank\tBar')
    expect(res.headers.map(h => h.field)).toEqual([
      'title', 'price', 'categoryTitle', 'locationTitle',
    ])
  })
  it('maps the English aliases incl. Active / Requires Remark / Remark Prompt / Description', () => {
    const res = parseProductPaste('Product Name\tPrice\tActive\tRequires Remark\tRemark Prompt\tDescription\nX\t3\tja\tnee\tp\td')
    expect(res.headers.map(h => h.field)).toEqual([
      'title', 'price', 'isActive', 'requiresRemark', 'remarkPrompt', 'description',
    ])
  })
  it('matches trimmed + case-insensitive (order swapped, casE mixed)', () => {
    const res = parseProductPaste(' PRIJS \tNAAM\n3\tPils')
    expect(res.headers[0].field).toBe('price')
    expect(res.headers[1].field).toBe('title')
  })
  it('leaves an unrecognized header unmapped (field null) but still parses the row', () => {
    const res = parseProductPaste('Name\tWibble\tPrice\nPils\txx\t3')
    expect(res.headers[1].field).toBeNull()
    expect(res.rows[0].title).toBe('Pils')
    expect(res.rows[0].price).toBe(3)
  })
})

describe('trailing empty columns are dropped', () => {
  it('drops trailing all-empty columns and counts them', () => {
    const res = parseProductPaste('Name\tPrice\t\t\nPils\t3\t\t\nGin\t4\t\t')
    expect(res.droppedTrailingColumns).toBe(2)
    expect(res.headers.map(h => h.name)).toEqual(['Name', 'Price'])
  })
  it('keeps a column that is empty in some rows but not all', () => {
    const res = parseProductPaste('Name\tLocation\nPils\tBar\nGin\t')
    expect(res.droppedTrailingColumns).toBe(0)
    expect(res.headers.map(h => h.name)).toEqual(['Name', 'Location'])
  })
})

describe('price parsing', () => {
  const cases: Array<[string, number]> = [
    ['3', 3],
    ['3.50', 3.5],
    ['3,50', 3.5],
    ['€ 3,50', 3.5],
    ['€3.50', 3.5],
    ['8,00', 8],
    ['€ 18', 18],
    ['0', 0],
  ]
  for (const [raw, expected] of cases) {
    it(`parses ${JSON.stringify(raw)} → ${expected}`, () => {
      const row = parseProductPaste(`Name\tPrice\nPils\t${raw}`).rows[0]
      expect(row.status).not.toBe('error')
      expect(row.price).toBe(expected)
    })
  }
  it('an unreadable price yields an error row with a reason', () => {
    const row = parseProductPaste('Name\tPrice\nKriek\tabc').rows[0]
    expect(row.status).toBe('error')
    expect(row.error).toMatch(/price/i)
  })
})

describe('boolean parsing', () => {
  for (const v of ['ja', 'yes', 'true', '1', 'x']) {
    it(`isActive ${JSON.stringify(v)} → true`, () => {
      expect(parseProductPaste(`Name\tActive\nPils\t${v}`).rows[0].isActive).toBe(true)
    })
  }
  for (const v of ['nee', 'no', 'false', '0']) {
    it(`isActive ${JSON.stringify(v)} → false`, () => {
      expect(parseProductPaste(`Name\tActive\nPils\t${v}`).rows[0].isActive).toBe(false)
    })
  }
})

/** The messy Armonia fixture from the epic's "How to test" (6 rows, 2 are bad). */
const messyFixture = [
  'Name\tPrice\tCategory\tLocation',
  'Pils\t3\tDrank\tBar',
  'Leffe blond\t4\tDrank\tbar',
  'Gin\t8,00\tDrank\tBar',
  'Fles cava\t€ 18\tDrank\tBar',
  '\t5\tDrank\tBar', // no name
  'Kriek\tabc\tDrank\tBar', // unreadable price
].join('\n')

describe('per-row status + resilience (messy fixture)', () => {
  it('parses all six rows without aborting the batch', () => {
    expect(parseProductPaste(messyFixture).rows).toHaveLength(6)
  })
  it('clean rows are `new` with correct prices (How-to-test step 4 reading)', () => {
    const [a, b, c, d] = parseProductPaste(messyFixture).rows
    expect(a).toMatchObject({ title: 'Pils', price: 3, status: 'new' })
    expect(b).toMatchObject({ title: 'Leffe blond', price: 4, status: 'new' })
    expect(c).toMatchObject({ title: 'Gin', price: 8, status: 'new' })
    expect(d).toMatchObject({ title: 'Fles cava', price: 18, status: 'new' })
  })
  it('the missing-name row is an error that does not kill the batch', () => {
    const row = parseProductPaste(messyFixture).rows[4]
    expect(row.status).toBe('error')
    expect(row.error).toMatch(/name/i)
  })
  it('the unreadable-price row is an error that does not kill the batch', () => {
    const row = parseProductPaste(messyFixture).rows[5]
    expect(row.status).toBe('error')
    expect(row.error).toMatch(/price/i)
  })
  it('surfaces relations to create — deduped + case-insensitive (Bar == bar)', () => {
    const titles = parseProductPaste(messyFixture)
      .relationsToCreate.map(r => `${r.kind}:${r.title}`).sort()
    expect(titles).toEqual(['category:Drank', 'location:Bar'])
  })
})

describe('duplicate detection (existing titles supplied by the caller)', () => {
  it('flags an existing title as warn-duplicate, skipped by default', () => {
    const row = parseProductPaste('Name\tPrice\nPils\t3', {
      existingProductTitles: ['Pils'],
    }).rows[0]
    expect(row.status).toBe('warn-duplicate')
    expect(row.duplicateOf).toBe('Pils')
    expect(row.create).toBe(false)
  })
  it('duplicate detection is trimmed + case-insensitive', () => {
    const row = parseProductPaste('Name\tPrice\n  pils \t3', {
      existingProductTitles: ['Pils'],
    }).rows[0]
    expect(row.status).toBe('warn-duplicate')
  })
  it('re-pasting the clean block against the 4 existing titles flags all 4 duplicate', () => {
    const paste = [
      'Name\tPrice\tCategory\tLocation',
      'Pils\t3\tDrank\tBar',
      'Leffe blond\t4\tDrank\tbar',
      'Gin\t8,00\tDrank\tBar',
      'Fles cava\t€ 18\tDrank\tBar',
    ].join('\n')
    const rows = parseProductPaste(paste, {
      existingProductTitles: ['Pils', 'Leffe blond', 'Gin', 'Fles cava'],
    }).rows
    expect(rows.every(r => r.status === 'warn-duplicate')).toBe(true)
  })
})
