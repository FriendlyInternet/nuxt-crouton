// @vitest-environment node
/**
 * layout_configs is TEAM-scoped: the same layout id (e.g. `default`) must be savable
 * by every team, each keeping its own row (#2543). The table is built from this
 * package's real schema (drizzle-kit, the same path the migrations take), so the
 * test exercises the actual key, not a description of it.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import * as schema from '../layoutConfigs'
import { layoutConfigs } from '../layoutConfigs'

let db: ReturnType<typeof drizzle>

beforeEach(async () => {
  const sqlite = new Database(':memory:')
  const statements = await generateSQLiteMigration(await generateSQLiteDrizzleJson({}), await generateSQLiteDrizzleJson(schema))
  for (const s of statements) sqlite.exec(s)
  db = drizzle(sqlite)
})

const tree = (blockId: string) => ({ renderer: 'panes', root: { type: 'leaf', blockId } })

describe('layout_configs is team-scoped (#2543)', () => {
  it('lets two teams each save a layout with the same id', () => {
    db.insert(layoutConfigs).values({ id: 'default', teamId: 'team-a', name: 'layout', renderer: 'panes', tree: tree('a') }).run()
    expect(() => db.insert(layoutConfigs).values({ id: 'default', teamId: 'team-b', name: 'layout', renderer: 'panes', tree: tree('b') }).run()).not.toThrow()
  })

  it('keeps each team on its own row', () => {
    db.insert(layoutConfigs).values({ id: 'default', teamId: 'team-a', name: 'layout', renderer: 'panes', tree: tree('a') }).run()
    db.insert(layoutConfigs).values({ id: 'default', teamId: 'team-b', name: 'layout', renderer: 'panes', tree: tree('b') }).run()
    const read = (teamId: string) => db.select().from(layoutConfigs).where(and(eq(layoutConfigs.id, 'default'), eq(layoutConfigs.teamId, teamId))).get()
    expect(read('team-a')?.tree).toEqual(tree('a'))
    expect(read('team-b')?.tree).toEqual(tree('b'))
  })

  it('still refuses a second row with the same id in the SAME team', () => {
    db.insert(layoutConfigs).values({ id: 'default', teamId: 'team-a', name: 'layout', renderer: 'panes', tree: tree('a') }).run()
    expect(() => db.insert(layoutConfigs).values({ id: 'default', teamId: 'team-a', name: 'layout', renderer: 'panes', tree: tree('x') }).run()).toThrow(/UNIQUE|PRIMARY/)
  })
})
