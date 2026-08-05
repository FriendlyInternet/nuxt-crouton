// tasks.mjs — the 3 golden-task definitions for WS6b.3 (#885).
//
// Each task is a small, representative, THROWAWAY-issue-shaped probe with a
// deterministic acceptance check — so "is model X good enough for tier Y?" can be
// answered before that model touches a real flow. Never run against `main`; always
// on fixtures / scratch paths (the #670 spike lesson).
//
// A task's `check(ctx)` is pure + deterministic (no LLM judge) and returns
// `{ ok: boolean, reason: string }`. `ctx` carries whatever paths the runner
// resolved (fixture dir, report path, scaffold dir) — see run.mjs.
//
// Dependency-free on purpose (node built-ins only), matching eval-ledger/schema.mjs.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @typedef {Object} GoldenTask
 * @property {string} id            short id, used as `flow: golden-<id>` in the ledger
 * @property {string} title
 * @property {string} promptSummary the throwaway-issue prompt a candidate model is given
 * @property {string} category      "reports-only" | "small-crud" | "scaffold"
 * @property {(ctx: any) => { ok: boolean, reason: string }} check
 */

/** @type {GoldenTask[]} */
export const GOLDEN_TASKS = [
  {
    id: 'reports-only',
    category: 'reports-only',
    title: 'Reports-only: write an a11y report for a fixture',
    promptSummary:
      'Run the `a11y` skill against `fixtures/minimal` and write the report to ' +
      '`writeups/reports/golden-reports-only.md` using the a11y report template ' +
      '(required sections, severity-rated findings). No code changes, no PR — a report only.',
    check(ctx) {
      const reportPath = ctx.reportPath ?? join(ctx.root, 'writeups/reports/golden-reports-only.md')
      if (!existsSync(reportPath)) {
        return { ok: false, reason: `report not found at ${reportPath}` }
      }
      const text = readFileSync(reportPath, 'utf8')
      const requiredHeadings = ['# ', '## Findings', '## Summary']
      const missing = requiredHeadings.filter((h) => !text.includes(h))
      if (missing.length) {
        return { ok: false, reason: `report missing required section(s): ${missing.join(', ')}` }
      }
      return { ok: true, reason: 'report present with required sections' }
    },
  },
  {
    id: 'small-crud',
    category: 'small-crud',
    title: 'Small CRUD: add one field to the minimal fixture and prove it round-trips',
    promptSummary:
      'Add a `notes` (text, optional) field to the `items` collection in `fixtures/minimal`, ' +
      'regenerate, and make sure the e2e smoke (login → create team → CRUD `items`) still passes ' +
      'with the new field visible in the form and list.',
    check(ctx) {
      const reportPath = ctx.playwrightReport ?? join(ctx.root, 'playwright-report/report.json')
      if (!existsSync(reportPath)) {
        return {
          ok: false,
          reason: `no playwright report at ${reportPath} — run e2e-smoke against fixtures/minimal first`,
        }
      }
      let report
      try {
        report = JSON.parse(readFileSync(reportPath, 'utf8'))
      } catch {
        return { ok: false, reason: `playwright report at ${reportPath} is not valid JSON` }
      }
      const stats = report?.stats ?? {}
      const failed = Number(stats.unexpected ?? stats.failed ?? 0)
      const expected = Number(stats.expected ?? 0)
      if (failed > 0) {
        return { ok: false, reason: `${failed} playwright spec(s) failed` }
      }
      if (expected === 0) {
        return { ok: false, reason: 'playwright report has zero passing specs (did it actually run?)' }
      }
      return { ok: true, reason: `${expected} spec(s) passed, 0 failed` }
    },
  },
  {
    id: 'scaffold',
    category: 'scaffold',
    title: 'Scaffold: `crouton init` a throwaway single-collection POC',
    promptSummary:
      'Run `crouton init golden-scaffold --features minimal` (or the CLI\'s scaffold-only path) ' +
      'against a throwaway `schemas/*.json` + `crouton.config.js`, then confirm the generated app ' +
      'boots (`nuxt build` / typecheck clean) — never committed to `main`.',
    check(ctx) {
      const scaffoldDir = ctx.scaffoldDir
      if (!scaffoldDir || !existsSync(scaffoldDir)) {
        return { ok: false, reason: `scaffold dir not found: ${scaffoldDir}` }
      }
      const required = ['package.json', 'crouton.config.js', 'nuxt.config.ts']
      const missing = required.filter((f) => !existsSync(join(scaffoldDir, f)))
      if (missing.length) {
        return { ok: false, reason: `scaffold missing required file(s): ${missing.join(', ')}` }
      }
      return { ok: true, reason: 'scaffold has the expected app shape' }
    },
  },
]

export function getTask(id) {
  return GOLDEN_TASKS.find((t) => t.id === id) ?? null
}
