#!/usr/bin/env node
// pi-local-capture.mjs — the pi worker's phone-width look at its own change (#2513).
//
// Asking pi to screenshot its work was proven not to work (#2057), so the WORKFLOW does it:
// boot the touched app locally (`pnpm preview` — seeds + mints the review login, #1777), sign in,
// and shoot the ticket's named surface at 390px and 1280px via capture-review-surfaces.mjs
// (which already rejects blank / error-page captures, #2055/#2061).
//
// Surface = the ticket's `Surface: <app> <path>[, <path>]` line, else derived from the changed
// page files, else NONE — never the home page (#2455). Time-boxed; every failure is recorded as
// a one-line reason (the PR body quotes it) instead of silently skipping. Never exits non-zero.
//
// Usage: node scripts/pi-local-capture.mjs --issue <N> --issue-body <file> --changed <file> \
//          [--out writeups/ui-proposals] [--status <json>] [--budget <seconds>]
// Output: `captured=<file>` per kept PNG; a status JSON { status, reason, files } for the workflow.

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from './lib/cli-args.mjs'
import { resolveTargets, toMarkers } from './lib/local-capture.mjs'
import { DEFAULT_EMAIL, DEFAULT_PASSWORD, findDevUrl, resolveApp } from './app-preview.mjs'

const log = msg => console.log(`[local-capture] ${msg}`)
const VIEWPORTS = [{ tag: '390', flags: [] }, { tag: '1280', flags: ['--desktop'] }]

/** Boot `pnpm preview <app>`; resolve with { url, stop } once it prints its sign-in banner. */
function bootPreview(app, deadline) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['preview', app], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] })
    const stop = () => { try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ } }
    let url = null
    let done = false
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v) } }
    const timer = setTimeout(() => finish({ url: null, stop, why: 'the app did not finish booting + seeding in time' }), Math.max(1000, deadline - Date.now()))
    child.stdout.on('data', (buf) => {
      const chunk = buf.toString()
      process.stdout.write(chunk)
      url ||= findDevUrl(chunk)
      if (url && chunk.includes('Ctrl-C to stop')) finish({ url, stop })
    })
    child.on('exit', () => finish({ url: null, stop, why: 'the dev server exited before it was ready' }))
  })
}

/** Shoot one viewport of a running app into `out`; returns the kept files and any problem. */
function shootViewport({ app, url, vp, issue, surfaces, out, deadline }) {
  const tmp = mkdtempSync(join(tmpdir(), 'localcap-'))
  const res = spawnSync('node', [
    'scripts/capture-review-surfaces.mjs', '--url', url, '--app', app, '--pr', String(issue),
    '--email', DEFAULT_EMAIL, '--password', DEFAULT_PASSWORD, '--out', tmp, ...vp.flags
  ], { env: { ...process.env, PR_BODY: toMarkers(surfaces) }, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'], timeout: Math.max(30_000, deadline - Date.now()) })
  const pngs = readdirSync(tmp).filter(f => f.endsWith('.png'))
  const problem = res.status !== 0 || !pngs.length ? `${app} @${vp.tag}px: no valid capture (blank, error page, or the route did not open)` : null
  mkdirSync(out, { recursive: true })
  const files = pngs.map((f) => {
    const dest = `${out}/${f.replace(/\.png$/, `-${vp.tag}.png`)}`
    copyFileSync(join(tmp, f), dest)
    return dest
  })
  return { files, problem }
}

/** Boot one app, shoot every viewport, always stop the server. */
async function captureApp({ app, surfaces, source, issue, out, deadline }) {
  log(`booting ${app} for ${surfaces.map(s => s.path).join(', ')} (${source})`)
  const { url, stop, why } = await bootPreview(app, deadline)
  const files = []
  const problems = []
  try {
    if (!url) return { files, problems: [`${app}: ${why}`] }
    for (const vp of VIEWPORTS) {
      const shot = shootViewport({ app, url, vp, issue, surfaces, out, deadline })
      files.push(...shot.files)
      if (shot.problem) problems.push(shot.problem)
    }
  } finally {
    stop()
  }
  return { files, problems }
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {})
  const out = args.out || 'writeups/ui-proposals'
  const deadline = Date.now() + (Number(args.budget) || 360) * 1000
  const report = (status, reason, files = []) => {
    log(`${status}: ${reason}`)
    if (args.status) writeFileSync(args.status, JSON.stringify({ status, reason, files }))
    for (const f of files) console.log(`captured=${f}`)
  }

  if (!args.issue) { report('failed', 'no --issue given'); return }
  const read = p => (p && existsSync(p) ? readFileSync(p, 'utf8') : '')
  const { surfaces, source } = resolveTargets({
    issueBody: read(args['issue-body']),
    changedFiles: read(args.changed).split('\n').filter(Boolean)
  })
  if (!surfaces.length) { report('no-surface', 'no surface named — add a `Surface: <app> <path>` line to the ticket'); return }

  const apps = [...new Set(surfaces.map(s => s.app))]
  const bad = apps.find(a => !resolveApp(a))
  if (bad) { report('failed', `surface names unknown app "${bad}"`); return }

  // One app at a time (ports are per-app); the time box is shared across all of them.
  const kept = []
  const problems = []
  for (const app of apps) {
    const r = await captureApp({ app, surfaces: surfaces.filter(s => s.app === app), source, issue: args.issue, out, deadline })
    kept.push(...r.files)
    problems.push(...r.problems)
  }
  if (kept.length) report('captured', problems.length ? `partial — ${problems.join('; ')}` : `captured ${kept.length} screenshot(s) (${source})`, kept)
  else report('failed', problems.join('; ') || 'no capture produced')
}

try { await main() } catch (e) { console.log(`[local-capture] crashed (non-fatal): ${e.message}`) }
process.exit(0)
