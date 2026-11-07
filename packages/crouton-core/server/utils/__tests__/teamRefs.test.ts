import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { assertRefsInTeam } from '../teamRefs'

const table = sqliteTable('locations', { id: text('id'), teamId: text('teamId') })

function fakeDb(rows: Array<{ id: string }>) {
  const where = vi.fn().mockResolvedValue(rows)
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  return { db: { select }, select, where }
}

describe('assertRefsInTeam (#3378)', () => {
  beforeEach(() => {
    ;(globalThis as any).createError = (e: any) => Object.assign(new Error(e.statusText), e)
  })

  const ref = (value: unknown) => [{ field: 'location', table, value }]

  it('same team ok', async () => {
    const { db } = fakeDb([{ id: 'a' }])
    await expect(assertRefsInTeam(db, 't1', ref('a'))).resolves.toBeUndefined()
  })

  it('other team / missing id → 400', async () => {
    const { db } = fakeDb([])
    await expect(assertRefsInTeam(db, 't1', ref('x'))).rejects.toMatchObject({
      status: 400,
      statusText: 'Invalid reference: location',
    })
  })

  it('null / undefined / empty run no query', async () => {
    const { db, select } = fakeDb([])
    for (const v of [null, undefined, '']) await assertRefsInTeam(db, 't1', ref(v))
    expect(select).not.toHaveBeenCalled()
  })

  it('arrays: partial match → 400, duplicates dedupe', async () => {
    await expect(assertRefsInTeam(fakeDb([{ id: 'a' }]).db, 't1', ref(['a', 'b']))).rejects.toMatchObject({ status: 400 })
    await expect(assertRefsInTeam(fakeDb([{ id: 'a' }]).db, 't1', ref(['a', 'a']))).resolves.toBeUndefined()
  })

  it('non-string values → 400', async () => {
    await expect(assertRefsInTeam(fakeDb([]).db, 't1', ref(5))).rejects.toMatchObject({ status: 400 })
  })

  it('scopes the lookup by team', async () => {
    const { db, where } = fakeDb([{ id: 'a' }])
    await assertRefsInTeam(db, 'team_42', ref('a'))
    const q = new SQLiteSyncDialect().sqlToQuery(where.mock.calls[0][0])
    expect(q.sql).toContain('"teamId"')
    expect(q.params).toContain('team_42')
  })
})
