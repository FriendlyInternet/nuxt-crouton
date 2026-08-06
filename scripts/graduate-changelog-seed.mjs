#!/usr/bin/env node
/**
 * Graduation changelog seed — issue #2036 (epic #1600 WS5+6).
 *
 * At the `/graduate` skill's Stage B (build), the new app's in-app changelog
 * (consumed by `@fyit/crouton-feedback`'s Changelog tool) should not start
 * empty — it should carry forward the POC's history as its seed, with app
 * commits accruing on top from graduation onward.
 *
 * The POC changelog (e.g. `pocs/<name>/app/spike-changelog.json`) and the
 * crouton-feedback `ChangelogEntry` shape are already the SAME
 * `{ v, note, commit? }` array — so "seeding" is a validating copy, not a
 * structural transform.
 *
 * "Is this a POC changelog file" is resolved via the declared stage model
 * (harness.config.mjs / scripts/harness-stages.mjs) rather than hardcoded
 * `poc`/`spike` path fragments, so the pending `poc` → `spike` stage rename
 * (see harness-stages.mjs's doc comment) doesn't ripple through this file —
 * the check is the stage's `deploy: 'preview'` property (the incubator's
 * defining trait), not its key name.
 *
 *   node scripts/graduate-changelog-seed.mjs <poc-changelog.json> <app-changelog.json>
 *
 * Library API:
 *   isIncubatorPath(path, model)      → true if path resolves to a preview-deploy stage
 *   seedAppChangelogFromPoc(entries)  → validated, version-descending, commit-backfilled entries
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadStages, stageForPath } from './harness-stages.mjs'

/**
 * True if `path` resolves (via the declared stage model) to an incubator
 * stage — identified by its `deploy: 'preview'` property, not by a
 * hardcoded `poc`/`spike` stage name, so a stage rename doesn't break this.
 */
export function isIncubatorPath(path, model) {
  const { stage } = stageForPath(path, model)
  return stage.deploy === 'preview'
}

/**
 * Validate + normalize a POC's raw changelog JSON into entries ready to seed
 * an app's `changelog.json`. Same shape crouton-feedback already expects
 * (`{ v, note, commit? }`, newest first) — malformed entries (missing
 * numeric `v`) are dropped; a non-array input yields `[]`. `commit` is
 * backfilled to `''` when absent so every entry has the field (the app's
 * own build-time git stamp fills the *new* top entry going forward).
 */
export function seedAppChangelogFromPoc(rawEntries) {
  if (!Array.isArray(rawEntries)) return []
  return rawEntries
    .filter((e) => !!e && typeof e === 'object' && typeof e.v === 'number')
    .map((e) => ({
      v: e.v,
      note: typeof e.note === 'string' ? e.note : '',
      commit: typeof e.commit === 'string' ? e.commit : ''
    }))
    .sort((a, b) => b.v - a.v)
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const [pocChangelogPath, appChangelogPath] = process.argv.slice(2)
  if (!pocChangelogPath || !appChangelogPath) {
    console.error('Usage: node scripts/graduate-changelog-seed.mjs <poc-changelog.json> <app-changelog.json>')
    process.exit(1)
  }

  const model = await loadStages()
  if (!isIncubatorPath(pocChangelogPath, model)) {
    console.error(`✖ ${pocChangelogPath} does not resolve to an incubator (preview-deploy) stage — refusing to seed from it.`)
    process.exit(1)
  }

  const raw = JSON.parse(readFileSync(pocChangelogPath, 'utf8'))
  const seeded = seedAppChangelogFromPoc(raw)
  writeFileSync(appChangelogPath, JSON.stringify(seeded, null, 2) + '\n')
  console.error(`✓ seeded ${seeded.length} changelog entries → ${appChangelogPath}`)
}
