// Generator for an editable per-collection seed fixture (seed.json).
//
// Unlike seed-data.ts (which emits a drizzle-seed `seed.ts` needing a live DB
// connection), this emits a small, committed, editable JSON fixture that the
// app-level seed runner (`crouton-seed` / seed-app.ts) loads and turns into
// idempotent upsert SQL via `@fyit/crouton-core/shared/seed`. So a freshly
// deployed app comes up with sample rows — its public surfaces aren't empty
// (#298). Rows are auto-derived from the schema; edit seed.json to replace them
// with real content.
import { AUTO_GENERATED_FIELDS, SYSTEM_FIELD_GROUPS } from '../utils/system-fields.ts'
import { toSnakeCase } from '../utils/helpers.ts'

// Auto-generated columns the runner injects (id, teamId, audit, timestamps) and
// hierarchy columns — never authored in the fixture.
const AUTO_FIELDS = new Set([...AUTO_GENERATED_FIELDS, ...SYSTEM_FIELD_GROUPS.hierarchy])

export interface SeedFixture {
  /** Physical table name (e.g. `blog_posts`). */
  table: string
  /** Natural-key field used to derive a stable seed id (e.g. `slug`); else row index. */
  key: string | null
  /** Sample rows — user fields only; the runner injects id/teamId/audit/timestamps. */
  rows: Array<Record<string, unknown>>
}

/** Derive a plausible literal sample value for a field at row `i`. */
function deriveValue(field: Record<string, any>, i: number): unknown {
  const name = String(field.name || '').toLowerCase()
  const options = field.meta?.options

  // A select/enum → cycle options, biased so the newest row leads with the
  // "last" option (e.g. `published` for [draft, published]) for a livelier demo.
  if (Array.isArray(options) && options.length > 0) {
    return options[(i + 1) % options.length]
  }

  // Name heuristics (more specific first)
  if (name === 'slug') return `sample-${i + 1}`
  if (name.includes('email')) return `user${i + 1}@example.com`
  if (name === 'title' || name === 'name' || name === 'fullname') return `Sample ${field.name} ${i + 1}`
  if (name.includes('url') || name.includes('website') || name.includes('link')) return 'https://example.com'

  // Type-based: the manifest's `seed.fixture` expression, evaluated per row.
  // Only a type the manifest doesn't know falls back to a string sample.
  if (field.seed?.fixture) return evalFixture(field.seed.fixture, field.name, i)
  return `Sample ${field.name} ${i + 1}`
}

/** Evaluate a manifest `seed.fixture` expression with `i`, `name` and `now` in scope. */
function evalFixture(expr: string, name: string, i: number): unknown {
  // The expression comes from a package manifest (trusted code we already load).
  return new Function('i', 'name', 'now', `return (${expr})`)(i, name, Date.now())
}

/**
 * Build a seed fixture for a collection. Returns `null` when no fixture should
 * be written (hierarchy collections — their parentId/path/depth/order seeding is
 * out of scope; edit by hand if needed).
 */
export function generateSeedFixture(data: Record<string, any>, count = 3): SeedFixture | null {
  const { layer, plural, fields, hierarchy } = data
  if (hierarchy?.enabled) return null

  const table = toSnakeCase(`${layer}_${plural}`)

  // User fields only. FK refs (refTarget) are skipped — they'd need real target
  // ids; leaving them out makes the column nullable-or-absent and avoids dangling
  // references in the sample data.
  const userFields = (fields as Array<Record<string, any>>).filter(
    f => !AUTO_FIELDS.has(f.name) && !f.refTarget,
  )

  if (userFields.length === 0) return null

  const key
    = userFields.find(f => f.name === 'slug')?.name
    ?? userFields.find(f => /name|title/i.test(f.name))?.name
    ?? null

  const rows = Array.from({ length: count }, (_, i) => {
    const row: Record<string, unknown> = {}
    for (const f of userFields) row[f.name] = deriveValue(f, i)
    return row
  })

  return { table, key, rows }
}
