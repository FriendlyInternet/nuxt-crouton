#!/usr/bin/env node
// bundle-size.mjs — DETERMINISTIC client-bundle measurement (#1581).
// Sums the raw + gzipped size of the built JS/CSS assets under an app's
// `.output/public/_nuxt` (Cloudflare Workers preset) — the numbers behind
// `nuxt analyze`, but as a trendable fact instead of a throwaway visualizer.
//
// Deterministic on purpose (same build → same bytes), so — unlike Lighthouse
// vitals — it can be a reliable budget, not a flaky one. Dep-free: node built-ins
// only (fs + zlib), so it runs in any CI step without install.
//
// Usage:
//   node scripts/perf/bundle-size.mjs --app velo --dir apps/velo/.output/public/_nuxt
//   node scripts/perf/bundle-size.mjs --app velo --dir <dir> --json
//   # regression band needs the prior point:
//   node scripts/perf/bundle-size.mjs --app velo --dir <dir> --history writeups/perf/bundle-history.jsonl
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/cli-args.mjs'
import { scoreBundle } from './scorecard.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TOP_CHUNKS = 12

/** Recursively collect every .js/.css file path under `dir`. */
function walk(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(js|mjs|css)$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * Pure measurement (importable + tested). Returns raw + gzipped totals split by
 * type, plus the top chunks by gzipped size. `gzip` is the transfer-shaped number
 * (what the client actually downloads) — the one the budget bands read.
 * @param {string} dir  a built assets dir (e.g. <app>/.output/public/_nuxt)
 */
export function measure(dir) {
  const files = walk(dir)
  const chunks = files.map((p) => {
    const bytes = statSync(p).size
    const gzip = gzipSync(readFileSync(p)).length
    const isCss = p.endsWith('.css')
    return { name: basename(p), bytes, gzip, kind: isCss ? 'css' : 'js' }
  })
  const sum = (k, kind) => chunks.filter((c) => c.kind === kind).reduce((s, c) => s + c[k], 0)
  const totalJs = sum('bytes', 'js'), gzipJs = sum('gzip', 'js')
  const totalCss = sum('bytes', 'css'), gzipCss = sum('gzip', 'css')
  return {
    fileCount: chunks.length,
    totalJs, gzipJs, totalCss, gzipCss,
    totalBytes: totalJs + totalCss,
    totalGzip: gzipJs + gzipCss,
    chunks: chunks.sort((a, b) => b.gzip - a.gzip).slice(0, TOP_CHUNKS),
  }
}

/** The prior recorded gzip total for `app` (for the regression band), or null. */
export function previousGzip(historyText, app) {
  const prior = historyText.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter((r) => r && r.app === app)
  return prior.length ? prior[prior.length - 1].totalGzip ?? null : null
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const args = parseArgs(process.argv.slice(2), { boolean: ['json', 'pretty'] })
  const app = args.app ? String(args.app) : null
  const dir = args.dir ? String(args.dir) : null
  if (!app || !dir) {
    console.error('bundle-size: --app and --dir are required')
    process.exit(2)
  }
  const m = measure(dir)
  const historyPath = args.history ? String(args.history) : join(ROOT, 'writeups/perf/bundle-history.jsonl')
  const prevGzip = existsSync(historyPath) ? previousGzip(readFileSync(historyPath, 'utf8'), app) : null
  const scorecard = scoreBundle(m.totalGzip, prevGzip)

  const record = {
    generatedAt: new Date().toISOString(),
    commit: args.commit ?? null,
    pr: args.pr != null ? Number(args.pr) : null,
    app,
    ...m,
    scorecard,
  }

  // Always emit the record as JSON on stdout (so it can pipe into append-bundle-history);
  // --pretty ADDS a human summary on stderr, keeping stdout a clean single JSON line.
  console.log(JSON.stringify(record))
  if ('pretty' in args) {
    const kb = (n) => (n / 1024).toFixed(1) + ' KB'
    console.error(`\n${app} bundle — ${scorecard.overall.toUpperCase()}`)
    console.error(`  JS  ${kb(m.totalJs)} raw · ${kb(m.gzipJs)} gzip`)
    console.error(`  CSS ${kb(m.totalCss)} raw · ${kb(m.gzipCss)} gzip`)
    console.error(`  total gzip ${kb(m.totalGzip)}${prevGzip ? ` (${scorecard.regression.pct >= 0 ? '+' : ''}${scorecard.regression.pct}% vs prev)` : ' (no prior point)'}`)
    console.error(`  top: ${m.chunks.slice(0, 3).map((c) => `${c.name} ${kb(c.gzip)}`).join(' · ')}`)
  }
}
