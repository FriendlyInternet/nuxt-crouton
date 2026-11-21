#!/usr/bin/env node
// Crate research agent (#2229) — look up up to 100 inbox tracks per run on the web, as a DJ would.
//
//   node pocs/crate/scripts/research.mjs [--limit 100] [--url …] [--model sonnet] [--dry-run]
//
// For each inbox track without a research tip yet: fetch the question the app builds for it
// (GET …/tracks/:id/research-prompt — the same one the card's "Ask Claude" shares), let
// `claude -p` research it with web search, and post the answer (…/research-answer) as the
// track's "Agent" tip — next to the Discogs/Bandcamp/"sounds like" tips.
// Runs on the Claude subscription; keep --limit small so a day's usage stays modest.
//
// Env (pocs/crate/.env): CRATE_EMAIL, CRATE_PASSWORD, optional CRATE_URL.
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = dirname(fileURLToPath(import.meta.url))
const envFile = join(here, '..', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const { values: args } = parseArgs({
  options: {
    'url': { type: 'string', default: process.env.CRATE_URL || 'https://crate-staging.pmcp.dev' },
    'limit': { type: 'string', default: '100' },
    'model': { type: 'string', default: 'sonnet' },
    'parallel': { type: 'string', default: '3' },
    'team': { type: 'string' },
    'dry-run': { type: 'boolean', default: false }
  }
})

// ── The app ───────────────────────────────────────────────────────────────────

async function login() {
  const res = await fetch(`${args.url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': args.url },
    body: JSON.stringify({ email: process.env.CRATE_EMAIL, password: process.env.CRATE_PASSWORD })
  })
  if (!res.ok) throw new Error(`Login failed: ${res.status}`)
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  return async (path, init = {}) => {
    const r = await fetch(`${args.url}${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'Origin': args.url, cookie, ...init.headers } })
    if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${r.status} ${await r.text()}`)
    return r.json()
  }
}

function research(prompt, schema) {
  return new Promise((resolve) => {
    const cli = ['-p', prompt, '--model', args.model, '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--allowedTools', 'WebSearch,WebFetch']
    // Run outside the repo so the agent doesn't pick up this project's instructions.
    execFile('claude', cli, { maxBuffer: 1e8, cwd: tmpdir(), timeout: 300_000 }, (err, out) => {
      let r = {}
      try { r = JSON.parse(out) } catch {}
      resolve({ answer: r.structured_output ?? null, cost: r.total_cost_usd ?? 0, error: err?.message?.slice(0, 200) })
    })
  })
}

// ── Run ───────────────────────────────────────────────────────────────────────

const api = await login()
const teams = await api('/api/auth/organization/list')
const team = teams.find(t => !args.team || [t.slug, t.id].includes(args.team)) ?? teams[0]
const base = `/api/teams/${team.id}/crate`
const queue = await api(`${base}/research-queue?limit=${Number(args.limit)}`)
console.log(`${queue.length} inbox tracks to research (limit ${args.limit})`)

if (args['dry-run']) {
  if (queue[0]) {
    const { prompt } = await api(`${base}/tracks/${queue[0].id}/research-prompt`)
    console.log(`\n${queue[0].artist} – ${queue[0].name}\n── prompt for the first track ──\n${prompt}`)
  }
  process.exit(0)
}

let uploaded = 0, cost = 0, failed = 0
const parallel = Number(args.parallel)
for (let i = 0; i < queue.length; i += parallel) {
  const batch = queue.slice(i, i + parallel)
  const saved = await Promise.all(batch.map(async (t) => {
    const { prompt, schema } = await api(`${base}/tracks/${t.id}/research-prompt`)
    const r = await research(prompt, schema)
    cost += r.cost
    if (!r.answer) {
      failed++
      console.log(`  ✗ ${t.artist} – ${t.name}: ${r.error ?? 'no answer'}`)
      return 0
    }
    // Save per track, so a stopped run keeps what it already found.
    try {
      await api(`${base}/tracks/${t.id}/research-answer`, { method: 'POST', body: JSON.stringify({ answer: r.answer }) })
    } catch (e) {
      failed++
      console.log(`  ✗ ${t.artist} – ${t.name}: ${e.message.slice(0, 200)}`)
      return 0
    }
    console.log(`  ✓ ${t.artist} – ${t.name}: ${r.answer.genres.map(g => g.word).join(', ')} [${r.answer.level}]`)
    return 1
  }))
  uploaded += saved.reduce((a, b) => a + b, 0)
}
console.log(`Researched ${uploaded} tracks, ${failed} failed · ~$${cost.toFixed(2)} of subscription usage`)
