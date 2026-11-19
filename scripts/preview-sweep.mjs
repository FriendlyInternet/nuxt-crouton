#!/usr/bin/env node
/**
 * preview-sweep.mjs — delete every PR preview (Worker, D1, KV) whose PR is no longer open.
 *
 * WHY a sweep, not "delete this PR's preview". The teardown used to act only on the PR whose
 * close event started the run. Two ways that leaked (found 19 Nov: 77 databases and 126 KV
 * stores of 72 closed PRs):
 *   1. GitHub starts no `pull_request` workflow for a PR that is in conflict with its base, so
 *      a PR closed in conflict never got a teardown at all (#3177, #3610, #3613, #3767 …).
 *   2. The step printed "✓" from `wrangler … | tail -1 && echo ✓` — tail always succeeds, so a
 *      failed delete read as done.
 * So: on any PR close, list what exists, delete what belongs to a PR that is not open, then
 * LOOK AGAIN and fail with the names of anything still there.
 *
 *   node scripts/preview-sweep.mjs            (needs GH_TOKEN, GITHUB_REPOSITORY,
 *                                              CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
 *   node scripts/preview-sweep.mjs --dry-run  prints the plan, deletes nothing
 *   exit 0 nothing left · 1 something is still there
 *
 *   node --test scripts/preview-sweep.test.mjs
 */
import { fileURLToPath } from 'node:url'
import { runWrangler, isAlreadyGone } from './lib/wrangler-d1.mjs'

// <app>-pr<N>, <app>-pr<N>-collab, and either with -db / -kv. Anything else is never touched.
const PREVIEW = /^.+-pr(\d+)(?:-collab)?(?:-db|-kv)?$/

/** The PR number a preview resource belongs to, or null when the name is not a preview. PURE. */
export function previewPr(name) {
  const m = PREVIEW.exec(String(name ?? ''))
  return m ? Number(m[1]) : null
}

/** What to delete: every preview resource whose PR is not in `openPrs`. PURE. */
export function planSweep({ workers = [], d1 = [], kv = [], openPrs = [] } = {}) {
  const open = new Set(openPrs.map(Number))
  const gone = (name) => { const pr = previewPr(name); return pr !== null && !open.has(pr) }
  return { workers: workers.filter(gone), d1: d1.filter(gone), kv: kv.filter(k => gone(k.title)) }
}

const names = plan => [...plan.workers, ...plan.d1, ...plan.kv.map(k => k.title)]

/**
 * List → plan → delete → list again. `io` does the talking (injectable, so tests need no
 * Cloudflare). A failed open-PR or resource listing throws BEFORE anything is deleted.
 * Returns { ok, deleted, left }.
 */
export async function runSweep(io, log = console, { dryRun = false } = {}) {
  const list = async () => ({ workers: await io.listWorkers(), d1: await io.listD1(), kv: await io.listKv() })
  const openPrs = await io.listOpenPrs()
  const plan = planSweep({ ...(await list()), openPrs })
  const planned = names(plan)
  log.info(`${openPrs.length} open PR(s); ${planned.length} preview resource(s) of closed PRs: ${plan.workers.length} worker(s), ${plan.d1.length} database(s), ${plan.kv.length} store(s)`)
  if (planned.length === 0) { log.info('nothing to delete'); return { ok: true, deleted: [], left: [] } }
  if (dryRun) { for (const n of planned) log.info(`would delete ${n}`); return { ok: true, deleted: [], left: planned } }

  const attempt = async (name, fn) => {
    try { await fn() } catch (e) { if (!isAlreadyGone(e.message)) log.error(`delete ${name} failed: ${String(e.message).split('\n')[0]}`) }
  }
  // Workers first: a database or store still bound to a live Worker may refuse to go.
  for (const w of plan.workers) await attempt(w, () => io.deleteWorker(w))
  for (const d of plan.d1) await attempt(d, () => io.deleteD1(d))
  for (const k of plan.kv) await attempt(k.title, () => io.deleteKv(k))

  const left = names(planSweep({ ...(await list()), openPrs })).filter(n => planned.includes(n))
  const deleted = planned.filter(n => !left.includes(n))
  for (const n of deleted) log.info(`deleted ${n}`)
  for (const n of left) log.error(`still there: ${n}`)
  return { ok: left.length === 0, deleted, left }
}

// ── real I/O ───────────────────────────────────────────────────────────────────────────
function realIo(env = process.env) {
  const need = k => { if (!env[k]) throw new Error(`${k} is not set`); return env[k] }
  const get = async (url, token) => {
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
    return r.json()
  }
  const wranglerJson = (args) => JSON.parse(runWrangler(args, { capture: true }))
  return {
    async listOpenPrs() {
      const out = []
      for (let page = 1; ; page++) {
        const rows = await get(`https://api.github.com/repos/${need('GITHUB_REPOSITORY')}/pulls?state=open&per_page=100&page=${page}`, need('GH_TOKEN'))
        out.push(...rows.map(p => p.number))
        if (rows.length < 100) return out
      }
    },
    async listWorkers() {
      const j = await get(`https://api.cloudflare.com/client/v4/accounts/${need('CLOUDFLARE_ACCOUNT_ID')}/workers/scripts`, need('CLOUDFLARE_API_TOKEN'))
      if (!Array.isArray(j.result)) throw new Error('Cloudflare returned no worker list')
      return j.result.map(w => w.id)
    },
    listD1: async () => wranglerJson(['d1', 'list', '--json']).map(d => d.name),
    listKv: async () => wranglerJson(['kv', 'namespace', 'list']).map(k => ({ title: k.title, id: k.id })),
    deleteWorker: async name => { runWrangler(['delete', '--name', name, '--force'], { capture: true }) },
    deleteD1: async name => { runWrangler(['d1', 'delete', name, '--skip-confirmation'], { capture: true }) },
    deleteKv: async k => { runWrangler(['kv', 'namespace', 'delete', '--namespace-id', k.id, '--skip-confirmation'], { capture: true }) },
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const log = { info: m => console.log(m), error: m => console.log(`::error::${m}`) }
  try {
    const r = await runSweep(realIo(), log, { dryRun: process.argv.includes('--dry-run') })
    process.exit(r.ok ? 0 : 1)
  } catch (e) {
    console.log(`::error::preview sweep stopped before deleting anything: ${e.message}`)
    process.exit(1)
  }
}
