import { describe, it, expect } from 'vitest'
import { filterSqlToExistingTables } from '../../lib/seed-app.ts'

describe('filterSqlToExistingTables (#1165)', () => {
  const sql = [
    'INSERT INTO "organization" ("id") VALUES (\'seed:org:test1\');',
    'INSERT INTO "bookings_locations" ("id") VALUES (\'x\');',
    'INSERT INTO "builder_artists" ("id") VALUES (\'a\');',
    'INSERT INTO "pages_pages" ("id") VALUES (\'p\');',
    'INSERT INTO "builder_pages" ("id") VALUES (\'home\');'
  ].join('\n')

  it('keeps INSERTs for existing tables, drops the rest', () => {
    const { sql: out, skipped } = filterSqlToExistingTables(sql, [
      'organization', 'builder_artists', 'builder_pages', 'user', 'member'
    ])
    expect(out).toContain('"organization"')
    expect(out).toContain('"builder_artists"')
    expect(out).toContain('"builder_pages"')
    expect(out).not.toContain('bookings_locations')
    expect(out).not.toContain('pages_pages')
    expect(skipped.get('bookings_locations')).toBe(1)
    expect(skipped.get('pages_pages')).toBe(1)
    expect(skipped.size).toBe(2)
  })

  it('is case-insensitive on the table name', () => {
    const { sql: out } = filterSqlToExistingTables(
      'INSERT INTO "Builder_Artists" ("id") VALUES (\'a\');',
      ['builder_artists']
    )
    expect(out).toContain('Builder_Artists')
  })

  it('keeps non-INSERT lines untouched', () => {
    const input = '-- a comment\nINSERT INTO "gone" ("id") VALUES (\'x\');\nSELECT 1;'
    const { sql: out } = filterSqlToExistingTables(input, ['kept'])
    expect(out).toContain('-- a comment')
    expect(out).toContain('SELECT 1;')
    expect(out).not.toContain('"gone"')
  })

  it('counts multiple dropped rows for the same table', () => {
    const input = [
      'INSERT INTO "gone" ("id") VALUES (\'1\');',
      'INSERT INTO "gone" ("id") VALUES (\'2\');'
    ].join('\n')
    const { skipped } = filterSqlToExistingTables(input, ['other'])
    expect(skipped.get('gone')).toBe(2)
  })
})
