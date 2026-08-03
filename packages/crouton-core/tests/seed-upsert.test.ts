import { describe, it, expect } from 'vitest'
import { buildUpsert } from '../shared/seed/sql'
import { collectSeedSql } from '../shared/seed/runner'
import type { SeedProvider } from '../shared/seed/types'

// The demo seed re-runs on every staging deploy. Its default upsert overwrites
// existing rows (DO UPDATE), which wipes a user's edits (reorder/rename/reprice)
// on the seeded event every deploy (#1579). `ifAbsent` makes a demo row seed once
// and then belong to the user: insert-if-missing, never clobber.

describe('buildUpsert insertOnly', () => {
  it('default: DO UPDATE SET on conflict (overwrites)', () => {
    const sql = buildUpsert('t', { id: 'x' }, { title: 'A', displayOrder: 1 })
    expect(sql).toContain('ON CONFLICT("id") DO UPDATE SET')
    expect(sql).toContain('"title" = excluded."title"')
    expect(sql).not.toContain('DO NOTHING')
  })

  it('insertOnly: forces DO NOTHING even with updatable columns (preserves edits)', () => {
    const sql = buildUpsert('t', { id: 'x' }, { title: 'A', displayOrder: 1 }, { insertOnly: true })
    expect(sql).toContain('ON CONFLICT("id") DO NOTHING')
    expect(sql).not.toContain('DO UPDATE')
    // still inserts the values when the row is absent
    expect(sql).toContain('"title"')
    expect(sql).toContain('"displayOrder"')
  })

  it('insertOnly takes precedence over immutable', () => {
    const sql = buildUpsert('t', { id: 'x' }, { title: 'A' }, { insertOnly: true, immutable: ['createdAt'] })
    expect(sql).toContain('DO NOTHING')
    expect(sql).not.toContain('DO UPDATE')
  })
})

describe('ctx.upsert ifAbsent (seed context)', () => {
  it('ifAbsent: true → the emitted statement is DO NOTHING', async () => {
    const provider: SeedProvider = {
      id: 'test',
      seed(ctx) {
        ctx.upsert('sales_categories', { id: 'c1' }, { title: 'Dranken', displayOrder: 1 }, { ifAbsent: true })
      }
    }
    const sql = await collectSeedSql({ providers: [provider], teamSlug: 't', teamId: 'team', locale: 'nl' })
    expect(sql).toContain('ON CONFLICT("id") DO NOTHING')
    expect(sql).not.toContain('DO UPDATE')
  })

  it('default upsert (no options) still DO UPDATE — behaviour unchanged for other seeds', async () => {
    const provider: SeedProvider = {
      id: 'test',
      seed(ctx) {
        ctx.upsert('some_table', { id: 'r1' }, { name: 'x' })
      }
    }
    const sql = await collectSeedSql({ providers: [provider], teamSlug: 't', teamId: 'team', locale: 'nl' })
    expect(sql).toContain('DO UPDATE SET')
  })
})
