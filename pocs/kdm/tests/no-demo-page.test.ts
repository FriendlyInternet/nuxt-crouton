// T1 (#4559) — the real crouton-pages seed never leaves a page in team kdm.
// Applies kdm's committed migrations (journal order) to an in-memory SQLite, then runs the
// same seed SQL the staging deploy runs (`crouton-seed --team kdm`). Migration 0001 keeps
// seed-owned pages out; the team row and pages with a real owner are left alone.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectSeedSql } from '@fyit/crouton-core/shared/seed'
import { createPageWithBlocks, provider as pagesProvider } from '@fyit/crouton-pages/seed'

// createRequire so vite does not try to resolve the node:sqlite builtin.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

const dir = resolve(__dirname, '../server/db/migrations/sqlite')
const tags: string[] = JSON.parse(readFileSync(resolve(dir, 'meta/_journal.json'), 'utf8'))
  .entries.sort((a: { idx: number }, b: { idx: number }) => a.idx - b.idx)
  .map((e: { tag: string }) => e.tag)

const TEAM_ID = 'seed:org:kdm'

function apply(db: any, tag: string) {
  const sql = readFileSync(resolve(dir, `${tag}.sql`), 'utf8')
  for (const stmt of sql.split('--> statement-breakpoint')) {
    if (stmt.trim()) db.exec(stmt)
  }
}

function freshDb(upTo = tags.length) {
  const db = new DatabaseSync(':memory:')
  for (const tag of tags.slice(0, upTo)) apply(db, tag)
  db.exec(`INSERT INTO organization (id, name, slug, createdAt) VALUES ('${TEAM_ID}', 'kdm', 'kdm', 0)`)
  return db
}

async function seed(db: any) {
  const sql = await collectSeedSql({
    providers: [pagesProvider],
    teamSlug: 'kdm',
    teamId: TEAM_ID,
    locale: 'en',
    createPageWithBlocks
  })
  db.exec(sql)
}

const pages = (db: any) => db.prepare('SELECT id, title, owner FROM pages_pages').all()

describe('kdm — no demo page in team kdm (#4559)', () => {
  it('has migration 0001 after 0000', () => {
    expect(tags[0]).toBe('0000_petite_joystick')
    expect(tags).toContain('0001_kdm_no_demo_page')
  })

  it('(a) seeding twice on the migrated database leaves no page, and the team stays', async () => {
    const db = freshDb()
    await seed(db)
    await seed(db)
    expect(pages(db)).toEqual([])
    expect(db.prepare('SELECT id, slug FROM organization').all()).toEqual([{ id: TEAM_ID, slug: 'kdm' }])
  })

  it('(b) migration 0001 removes a demo page an earlier seed left', async () => {
    const db = freshDb(1)
    await seed(db)
    expect(pages(db).map((p: { id: string }) => p.id)).toEqual(['seed:page:kdm:welcome'])
    apply(db, '0001_kdm_no_demo_page')
    expect(pages(db)).toEqual([])
  })

  it('(c) a page with a real owner inserts and its update sticks', () => {
    const db = freshDb()
    db.exec(`INSERT INTO pages_pages (id, teamId, owner, path, depth, "order", title, slug, pageType, status, visibility, createdAt, updatedAt, createdBy, updatedBy)
      VALUES ('p1', '${TEAM_ID}', 'u1', '/p1/', 0, 0, 'Home', 'home', 'pages:regular', 'published', 'public', 0, 0, 'u1', 'u1')`)
    db.exec(`UPDATE pages_pages SET title = 'Home2' WHERE id = 'p1'`)
    expect(pages(db)).toEqual([{ id: 'p1', title: 'Home2', owner: 'u1' }])
  })
})
