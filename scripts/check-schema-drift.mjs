#!/usr/bin/env node
/**
 * #1769 — ratchet against silent app↔package schema drift.
 *
 * WHY THIS EXISTS: `packages/<pkg>/schemas/` is the canonical definition of a package's
 * collections, but every consuming app gets its **own copy** under `<app>/schemas/`. From
 * install onwards the two evolve independently and nothing compares them. The copies fork
 * silently and stay forked forever.
 *
 * That is not hypothetical. kassa's `products.json` never carried `required: true` on
 * `categoryId`/`locationId` — the package's did. So kassa generated `text('locationId')`
 * with no `.notNull()`, a product with no prep location was reachable through the normal
 * UI, and its order items then routed to **no kitchen screen at all** (#1766). The package
 * form even rendered the field with a required asterisk; nothing enforced it. Nobody saw
 * the divergence because nobody was looking.
 *
 * WHY IT IS NOT A TEXT DIFF: most divergence is legitimate. `apps/triage/schemas/pages.json`
 * differs from the package's by 178 lines of deliberate app-specific customisation. A byte
 * comparison drowns the one line that matters in the 178 that don't. So this compares
 * FIELDS, and splits what it finds:
 *
 *   behavioural — `type`, `refTarget`, `meta.required`/`default`/`unique`/`maxLength`/…
 *                 These change the generated column, the zod schema, and the migration.
 *                 This is the #1769 class. Undeclared ⇒ EXIT 1.
 *   cosmetic    — `label`, `helpText`, `group`, … Reported, never fatal.
 *
 * WHY A BASELINE AND NOT A SYNC: there are already ~18 diverged pairs, most of them
 * intentional. Declaring them is the point — a `reason` line turns "we meant to change
 * this" from tribal knowledge into a reviewable diff. The ratchet then fails only on drift
 * nobody has declared, which is exactly what #1769 asks for: make the NEXT divergence
 * visible rather than silent.
 *
 * An UNKNOWN meta key counts as behavioural. A ratchet must fail toward demanding a
 * declaration, never toward silently passing something it doesn't understand.
 *
 * Usage:
 *   node scripts/check-schema-drift.mjs           # verify; exit 1 on undeclared drift
 *   node scripts/check-schema-drift.mjs --json     # machine-readable report
 *   node scripts/check-schema-drift.mjs --update   # rewrite the baseline from reality
 *   node --test scripts/check-schema-drift.test.mjs
 *
 * `--update` is how you seed or re-declare. It preserves any `reason` already written, so
 * re-running it never eats the prose that gives the file its value.
 *
 * NB `scripts/schema-diff.mjs` is a DIFFERENT tool despite the name: it diffs SQL migration
 * files for squash safety (#1717). This one diffs the schema JSON copies.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const BASELINE_PATH = 'scripts/schema-drift.baseline.json'

/** Roots whose `<member>/schemas/` holds copies of a package's. */
const CONSUMER_ROOTS = ['apps', 'pocs', 'fixtures']
const PACKAGE_ROOT = 'packages'

/**
 * Presentation-only keys. Everything NOT listed here is treated as behavioural — see the
 * fail-toward-declaring rule above. Kept as an explicit allowlist so adding a new meta key
 * to the generator surfaces here as drift until someone classifies it.
 */
const COSMETIC_KEYS = new Set([
  'label', 'description', 'helpText', 'help', 'icon',
  'area', 'group', 'addLabel', 'displayAs', 'sortable',
  'component', 'repeaterComponent', 'creatable',
  'dependsOn', 'dependsOnField', 'dependsOnCollection',
])

/** Wrapper-level keys that are presentation-only (`fields`/`hierarchy` are handled separately). */
const COSMETIC_WRAPPER_KEYS = new Set(['name', 'label', 'icon', 'description'])

/**
 * Three shapes are in use across this repo, and a consumer may use one while its package
 * uses another — so normalise to `{ fields: { name: def }, wrapper }` first, or the FORMAT
 * difference swamps the one real difference underneath it:
 *
 *   1. flat        `{ title: { type, meta } }`
 *   2. wrapper+obj `{ name, label, …, fields: { title: { type, meta } } }`
 *   3. wrapper+arr `{ name, label, …, fields: [ { name: 'title', type, label, required } ] }`
 *
 * In shape 3 the meta keys are flattened onto the def rather than nested under `meta`, so
 * `normalizeDef` lifts `meta` up on the other two. Without that, one side's
 * `title.maxLength` and the other's `title.meta.maxLength` report as two differences when
 * they are the same fact stated twice.
 */
export function normalizeDef(def) {
  const { meta, ...rest } = def ?? {}
  return { ...rest, ...(meta ?? {}) }
}

/**
 * `[{ name: 'title', … }]` → `{ title: { … } }`. Keyed on `name` so a pure REORDER never
 * reads as drift; the index is a fallback for a malformed entry, which is worth surfacing
 * rather than silently dropping.
 */
function keyByName(fields) {
  const byName = {}
  fields.forEach((def, i) => {
    const { name, ...rest } = def ?? {}
    byName[name ?? `#${i}`] = rest
  })
  return byName
}

export function normalizeSchema(json) {
  if (!json?.fields || typeof json.fields !== 'object') return { fields: json ?? {}, wrapper: {} }
  const { fields, ...wrapper } = json
  return { fields: Array.isArray(fields) ? keyByName(fields) : fields, wrapper }
}

/** Stable, comparable rendering of a value (key order must not read as a difference). */
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
}

/** `meta.required` → behavioural; `meta.label` → cosmetic. Unknown ⇒ behavioural. */
function severityForKey(key) {
  return COSMETIC_KEYS.has(key) ? 'cosmetic' : 'behavioural'
}

/** Compare one field's definition on both sides into `{ path, severity, consumer, package }`. */
function diffFieldDef(fieldName, consumerDef, packageDef) {
  const cd = normalizeDef(consumerDef)
  const pd = normalizeDef(packageDef)
  const out = []
  for (const key of new Set([...Object.keys(cd), ...Object.keys(pd)])) {
    if (stable(cd[key]) === stable(pd[key])) continue
    out.push({ path: `${fieldName}.${key}`, severity: severityForKey(key), consumer: cd[key], package: pd[key] })
  }
  return out
}

/**
 * Full comparison of a consumer copy against its package original.
 * `+field` = present only in the consumer, `-field` = present only in the package.
 * Both are behavioural: an extra field adds a column, a missing one loses it.
 */
export function compareSchemas(consumerJson, packageJson) {
  const c = normalizeSchema(consumerJson)
  const p = normalizeSchema(packageJson)
  const diffs = []

  for (const key of new Set([...Object.keys(c.wrapper), ...Object.keys(p.wrapper)])) {
    if (stable(c.wrapper[key]) === stable(p.wrapper[key])) continue
    diffs.push({
      path: `$${key}`,
      severity: COSMETIC_WRAPPER_KEYS.has(key) ? 'cosmetic' : 'behavioural',
      consumer: c.wrapper[key],
      package: p.wrapper[key],
    })
  }

  for (const name of Object.keys(c.fields)) {
    if (name in p.fields) diffs.push(...diffFieldDef(name, c.fields[name], p.fields[name]))
    else diffs.push({ path: `+${name}`, severity: 'behavioural', consumer: c.fields[name], package: undefined })
  }
  for (const name of Object.keys(p.fields)) {
    if (name in c.fields) continue
    diffs.push({ path: `-${name}`, severity: 'behavioural', consumer: undefined, package: p.fields[name] })
  }

  diffs.sort((a, b) => a.path.localeCompare(b.path))
  return {
    behavioural: diffs.filter(d => d.severity === 'behavioural'),
    cosmetic: diffs.filter(d => d.severity === 'cosmetic'),
  }
}

/**
 * Judge one pair against its baseline entry.
 *   undeclared — behavioural drift with no entry at all
 *   new        — behavioural drift the entry doesn't list (the ratchet's real job)
 *   stale      — the entry lists a path that no longer diverges
 *
 * `stale` is NOT a failure: converging a field is a good change and must not turn CI red.
 * It is reported so the baseline can be pruned with `--update`.
 */
export function assessPair({ consumer, packageFile, diffs, entry }) {
  const behaviouralPaths = diffs.behavioural.map(d => d.path)
  const declared = entry?.fields ?? []
  const isNew = behaviouralPaths.filter(p => !declared.includes(p))
  const stale = declared.filter(p => !behaviouralPaths.includes(p))
  const status = behaviouralPaths.length === 0
    ? 'clean'
    : !entry
        ? 'undeclared'
        : isNew.length > 0 ? 'new' : 'declared'
  return { consumer, packageFile, status, behavioural: diffs.behavioural, cosmetic: diffs.cosmetic, new: isNew, stale }
}

export function formatReport(results) {
  const lines = []
  const failing = results.filter(r => r.status === 'undeclared' || r.status === 'new')
  const declared = results.filter(r => r.status === 'declared')
  const staleOnly = results.filter(r => r.status !== 'undeclared' && r.status !== 'new' && r.stale.length > 0)
  const cosmetic = results.filter(r => r.status !== 'undeclared' && r.status !== 'new' && r.cosmetic.length > 0)

  for (const r of failing) {
    const paths = r.status === 'undeclared' ? r.behavioural.map(d => d.path) : r.new
    lines.push(`✗ ${r.consumer}`)
    lines.push(`  vs ${r.packageFile}`)
    lines.push(`  ${r.status === 'undeclared' ? 'undeclared drift' : 'NEW drift not in the baseline'}:`)
    for (const path of paths) {
      const d = r.behavioural.find(x => x.path === path)
      lines.push(`    ${path}  consumer=${stable(d?.consumer)}  package=${stable(d?.package)}`)
    }
  }
  for (const r of staleOnly) {
    lines.push(`· ${r.consumer}: baseline lists ${r.stale.length} path(s) that no longer diverge (${r.stale.join(', ')}) — prune with --update`)
  }
  if (cosmetic.length) {
    lines.push(`· ${cosmetic.length} pair(s) differ only in wording (label/helpText/group) — not fatal`)
  }
  lines.push('')
  lines.push(failing.length
    ? `${failing.length} pair(s) carry undeclared behavioural drift. Reconcile them, or declare each with a reason: node ${BASELINE_PATH.replace('schema-drift.baseline.json', 'check-schema-drift.mjs')} --update`
    : `schema drift OK — ${declared.length} declared, ${results.length - declared.length} clean`)
  return lines.join('\n')
}

/**
 * `<root>/<member>/schemas/*.json`, as repo-relative paths.
 * Hand-rolled rather than `fs.globSync` because CI runs Node 20, where that does not exist.
 */
function schemaFilesUnder(root, workspaceRoot) {
  const base = join(workspaceRoot, root)
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true })
    .filter(member => member.isDirectory())
    .flatMap((member) => {
      const dir = join(base, member.name, 'schemas')
      if (!existsSync(dir)) return []
      return readdirSync(dir)
        .filter(file => file.endsWith('.json'))
        .map(file => `${root}/${member.name}/schemas/${file}`)
    })
}

/** Pair every consumer schema with the same-named package schema, if one exists. */
export function discoverPairs(root = REPO_ROOT) {
  const packages = new Map()
  for (const p of schemaFilesUnder(PACKAGE_ROOT, root)) {
    const base = p.split('/').pop()
    // First package wins; a basename served by two packages is ambiguous, so keep it stable.
    if (!packages.has(base)) packages.set(base, p)
  }
  const pairs = []
  for (const consumerRoot of CONSUMER_ROOTS) {
    for (const c of schemaFilesUnder(consumerRoot, root)) {
      const pkg = packages.get(c.split('/').pop())
      if (pkg) pairs.push({ consumer: c, packageFile: pkg })
    }
  }
  return pairs.sort((a, b) => a.consumer.localeCompare(b.consumer))
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'))
}

export function run(root = REPO_ROOT) {
  const baselinePath = join(root, BASELINE_PATH)
  const baseline = existsSync(baselinePath) ? readJson(root, BASELINE_PATH) : {}
  return discoverPairs(root).map(pair => assessPair({
    ...pair,
    diffs: compareSchemas(readJson(root, pair.consumer), readJson(root, pair.packageFile)),
    entry: baseline[pair.consumer],
  }))
}

/** Rebuild the baseline from reality, preserving every `reason` already written. */
export function buildBaseline(results, previous = {}) {
  const next = {
    $comment: 'Declared app↔package schema divergences (#1769). Each entry says WHY a consumer '
      + 'copy differs from packages/*/schemas. Undeclared behavioural drift fails CI. '
      + 'Regenerate with: node scripts/check-schema-drift.mjs --update',
  }
  for (const r of results) {
    if (r.behavioural.length === 0) continue
    next[r.consumer] = {
      package: r.packageFile,
      reason: previous[r.consumer]?.reason ?? 'UNREVIEWED — pre-existing divergence captured when the ratchet landed (#1769).',
      fields: r.behavioural.map(d => d.path),
    }
  }
  return next
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const results = run()
  if (args.includes('--update')) {
    const path = join(REPO_ROOT, BASELINE_PATH)
    const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
    writeFileSync(path, `${JSON.stringify(buildBaseline(results, previous), null, 2)}\n`)
    console.log(`Wrote ${relative(REPO_ROOT, path)} — ${results.filter(r => r.behavioural.length).length} declared divergence(s).`)
    console.log('Now replace each UNREVIEWED reason with why that copy differs, or reconcile it.')
    process.exit(0)
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    console.log(formatReport(results))
  }
  process.exit(results.some(r => r.status === 'undeclared' || r.status === 'new') ? 1 : 0)
}
