#!/usr/bin/env node
// bundle-size.mjs — DETERMINISTIC bundle measurement, CLIENT + SERVER (#1581).
// Measures two things that answer two different questions:
//   - CLIENT bundle  (public/_nuxt)        → what the browser downloads → user load speed.
//   - SERVER/Worker bundle (wrangler-built) → Cloudflare cold-start + CPU → cost to RUN.
//
// The numbers behind `nuxt analyze`, but as a trendable fact instead of a throwaway
// visualizer. Deterministic (same build → same bytes), so — unlike Lighthouse vitals —
// it can be a reliable budget. Dep-free: node built-ins only (fs + zlib).
//
// IMPORTANT — the server number: `.output/server` is the UNBUNDLED Nitro output (hundreds
// of chunks, most tree-shaken away at deploy) — measuring it overstates the real Worker by
// multiples. The honest server number is the WRANGLER-BUNDLED Worker: run
// `wrangler deploy --dry-run --outdir <dir>` (offline; the workflow does this) and pass that
// dir as --server-dir. The engine just measures whatever dir it's given; producing the real
// Worker bundle is the caller's job (keeps this script dep-free + testable).
//
// Usage:
//   node scripts/perf/bundle-size.mjs --app velo \
//     --dir apps/velo/.output/public/_nuxt \        # client (browser)
//     --server-dir apps/velo/.wrangler-bundle \     # optional: wrangler-bundled Worker
//     --commit $SHA --pr 123 [--pretty]
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/cli-args.mjs'
import { scoreBundle, CLIENT_SIZE_BANDS, SERVER_SIZE_BANDS, worst } from './scorecard.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TOP_CHUNKS = 12

/** Recursively collect every .js/.mjs/.css file path under `dir`. */
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
 * Pure measurement (importable + tested). Raw + gzipped totals split by type, plus the
 * top chunks by gzipped size. `totalGzip` is the transfer-shaped number the bands read.
 * @param {string} dir  a built assets dir
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

/**
 * The prior recorded gzip totals for `app` (for the regression bands). Returns
 * { client, server } — either may be null (no prior point, or that target wasn't measured).
 */
export function previousGzip(historyText, app) {
  const prior = historyText.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter((r) => r && r.app === app)
  const last = prior.length ? prior[prior.length - 1] : null
  return {
    client: last?.client?.totalGzip ?? last?.totalGzip ?? null, // tolerate the pre-split shape
    server: last?.server?.totalGzip ?? null,
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const args = parseArgs(process.argv.slice(2), { boolean: ['json', 'pretty'] })
  const app = args.app ? String(args.app) : null
  const dir = args.dir ? String(args.dir) : null
  if (!app || !dir) {
    console.error('bundle-size: --app and --dir (client _nuxt) are required')
    process.exit(2)
  }
  const serverDir = args['server-dir'] ? String(args['server-dir']) : null

  const historyPath = args.history ? String(args.history) : join(ROOT, 'writeups/perf/bundle-history.jsonl')
  const prev = existsSync(historyPath) ? previousGzip(readFileSync(historyPath, 'utf8'), app) : { client: null, server: null }

  const clientM = measure(dir)
  const client = { ...clientM, scorecard: scoreBundle(clientM.totalGzip, prev.client, CLIENT_SIZE_BANDS) }

  let server = null
  if (serverDir && existsSync(serverDir)) {
    const serverM = measure(serverDir)
    server = { ...serverM, scorecard: scoreBundle(serverM.totalGzip, prev.server, SERVER_SIZE_BANDS) }
  }

  const record = {
    generatedAt: new Date().toISOString(),
    commit: args.commit ?? null,
    pr: args.pr != null ? Number(args.pr) : null,
    app,
    client,
    server,
    // convenience top-level rollups (for logs + the digest one-liner)
    clientGzip: client.totalGzip,
    serverGzip: server?.totalGzip ?? null,
    totalGzip: client.totalGzip + (server?.totalGzip ?? 0),
    overall: worst([client.scorecard.overall, server?.scorecard.overall]),
  }

  // Always emit the record as JSON on stdout (so it can pipe into append-bundle-history);
  // --pretty ADDS a human summary on stderr, keeping stdout a clean single JSON line.
  console.log(JSON.stringify(record))
  if ('pretty' in args) {
    const kb = (n) => (n / 1024).toFixed(1) + ' KB'
    const line = (label, m) => `  ${label}: ${kb(m.totalGzip)} gzip [${m.scorecard.overall.toUpperCase()}]` +
      `${m.scorecard.regression.prevGzip ? ` (${m.scorecard.regression.pct >= 0 ? '+' : ''}${m.scorecard.regression.pct}% vs prev)` : ''}` +
      ` · top: ${m.chunks.slice(0, 2).map((c) => `${c.name} ${kb(c.gzip)}`).join(' · ')}`
    console.error(`\n${app} bundle — overall ${record.overall.toUpperCase()}`)
    console.error(line('CLIENT (browser)', client))
    console.error(server ? line('SERVER (Worker) ', server) : '  SERVER: not measured (no --server-dir)')
  }
}
