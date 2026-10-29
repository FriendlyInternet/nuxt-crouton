#!/usr/bin/env node
// layer: stack
// seed.template.mjs — TEMPLATE for a per-app idempotent seed script (epic #265).
//
// Copy to `<app>/scripts/seed.mjs` and wire `"seed": "node scripts/seed.mjs"` in the
// app's package.json, so `pnpm --filter <app> seed` populates demo data in one command
// (replaces ad-hoc inline seeding). Customize the rows for the app's collections.
//
// Data seeding is inherently per-schema, hence a template. The local dev DB lives at
// <app>/.data/db/sqlite.db (NuxtHub sqlite); pass --remote handling as needed for D1.
//
//   LOCAL:  node scripts/seed.mjs
//   (Run the app once first so migrations create the tables.)
//
// Auth on a preview: a public/admin app needs a user to be "testable with auth". The
// robust, generic way is to register the admin through the running app's better-auth
// sign-up endpoint (works local or deployed) rather than hand-hashing passwords here —
// or enable self-registration on the POC. See the `poc-deploy` skill's auth note.

import { createClient } from '@libsql/client'

const DB_URL = process.env.SEED_DB_URL || 'file:.data/db/sqlite.db'
const db = createClient({ url: DB_URL })

const nowS = Math.floor(Date.now() / 1000) // drizzle 'timestamp' mode stores seconds
const rid = () => Math.random().toString(36).slice(2, 12)

// ── Customize: one entry per row you want to seed for THIS app's collection(s). ──
const TABLE = 'blog_posts' // ← your collection's table name
const ROWS = [
  {
    // teamId/owner are placeholders for a single public POC; real apps use real ids.
    teamId: 'seed-team', owner: 'seed-user',
    title: 'Hello from the seed script', slug: 'hello-seed',
    body: '<p>This row was created idempotently by the app seed script.</p>',
    author: 'Seed', publishedAt: nowS, status: 'published', tags: JSON.stringify(['demo']),
  },
]

async function main() {
  // Idempotent: skip rows whose unique key (slug) already exists.
  for (const r of ROWS) {
    const exists = await db.execute({
      sql: `SELECT 1 FROM ${TABLE} WHERE slug = ? LIMIT 1`,
      args: [r.slug],
    }).then((x) => x.rows.length > 0).catch(() => false)
    if (exists) { console.log(`• skip ${r.slug} (exists)`); continue }

    await db.execute({
      sql: `INSERT INTO ${TABLE}
        (id, teamId, owner, title, slug, body, author, publishedAt, status, tags, createdAt, updatedAt, createdBy, updatedBy)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [rid(), r.teamId, r.owner, r.title, r.slug, r.body, r.author, r.publishedAt, r.status, r.tags, nowS, nowS, r.owner, r.owner],
    })
    console.log(`✓ seeded ${r.slug}`)
  }
}

main().catch((e) => { console.error('seed failed:', e.message); process.exit(1) })
