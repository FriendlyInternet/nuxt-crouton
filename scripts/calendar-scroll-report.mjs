#!/usr/bin/env node
/**
 * calendar-scroll-report.mjs — the logic behind .github/workflows/calendar-scroll.yml (#3813).
 *
 *   node scripts/calendar-scroll-report.mjs preview-urls --sha <head-sha> [--timeout-min 40]
 *     Waits for the "Deploy POCs (preview)" run on that commit, downloads its
 *     preview-meta-crouton-builder / preview-meta-booking-demo records and prints
 *     BUILDER_URL=… / BOOKING_DEMO_URL=… lines (append them to $GITHUB_ENV). Exit 1 when
 *     the deploy failed or a record is missing — the test must never run against nothing.
 *
 *   node scripts/calendar-scroll-report.mjs report --log <file> --job <id> --title <t> [--pr <n>]
 *     Reads the CALSCROLL lines the deployed spec printed, renders a per-run table plus a
 *     per-case count, prints it (for $GITHUB_STEP_SUMMARY) and, with --pr, writes it into
 *     the PR body between <!-- calendar-scroll:<id> --> markers (the rest of the body,
 *     including the Closes line, is left untouched).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Parse `CALSCROLL key=value …` lines (cleanup lines are skipped). */
export function parseLines(text) {
  const runs = []
  for (const line of String(text).split('\n')) {
    const at = line.indexOf('CALSCROLL ')
    if (at < 0) continue
    const fields = {}
    for (const tok of line.slice(at + 10).trim().split(/\s+/)) {
      const eq = tok.indexOf('=')
      if (eq > 0) fields[tok.slice(0, eq)] = tok.slice(eq + 1)
    }
    if (fields.app && fields.case && fields.result) runs.push(fields)
  }
  return runs
}

/** Per app+case: how many runs, how many failed. Order of first appearance. */
export function summarize(runs) {
  const by = new Map()
  for (const r of runs) {
    const key = `${r.app} ${r.case}`
    const s = by.get(key) ?? { app: r.app, case: r.case, runs: 0, failed: 0 }
    s.runs++
    if (r.result !== 'pass') s.failed++
    by.set(key, s)
  }
  return [...by.values()]
}

export function renderSection(runs, title) {
  const engines = [...new Set(runs.map(r => r.engine).filter(Boolean))].join(', ') || '?'
  const target = [...new Set(runs.map(r => r.target).filter(Boolean))].join(', ') || '?'
  const lines = [`#### ${title}`, '', `Engine: **${engines}** · target: **${target}** · ${runs.length} run(s)`, '']
  if (!runs.length) {
    lines.push('⚠️ No CALSCROLL lines — the test did not run (see the job log).')
    return lines.join('\n')
  }
  lines.push('| Case | Failed | Runs |', '|---|---|---|')
  for (const s of summarize(runs)) lines.push(`| ${s.app} ${s.case} | ${s.failed} | ${s.runs} |`)
  lines.push('', '<details><summary>Every run</summary>', '', '| # | Case | scroll before → after | Month | Wrong-month frames | Result |', '|---|---|---|---|---|---|')
  runs.forEach((r, i) => lines.push(`| ${i + 1} | ${r.app} ${r.case} | ${r.before} → ${r.after} | ${r.month ?? ''} | ${r.wrongFrames ?? ''} | ${r.result} |`))
  lines.push('', '</details>')
  return lines.join('\n')
}

/** Replace (or append) the marked section; everything else in the body is kept as-is. */
export function spliceBody(body, id, section) {
  const open = `<!-- calendar-scroll:${id} -->`
  const close = `<!-- /calendar-scroll:${id} -->`
  const block = `${open}\n${section}\n${close}`
  const text = String(body ?? '')
  const a = text.indexOf(open)
  const b = text.indexOf(close)
  if (a >= 0 && b > a) return text.slice(0, a) + block + text.slice(b + close.length)
  return `${text.replace(/\s+$/, '')}\n\n${block}\n`
}

/** Pick the deploy run for a commit: newest first; null while none exists. */
export function pickDeployRun(runs) {
  const list = Array.isArray(runs) ? runs : []
  return list[0] ?? null
}

function arg(argv, name, fallback = '') {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}

const gh = (args, opts = {}) => execFileSync('gh', args, { encoding: 'utf8', ...opts })

async function previewUrls(argv) {
  const sha = arg(argv, 'sha')
  const limitMs = Number(arg(argv, 'timeout-min', '40')) * 60_000
  if (!sha) throw new Error('--sha is required')
  const start = Date.now()
  let run = null
  for (;;) {
    const list = JSON.parse(gh(['run', 'list', '--workflow', 'deploy-pocs.yml', '--commit', sha, '--event', 'pull_request', '--json', 'databaseId,status,conclusion']))
    run = pickDeployRun(list)
    if (run && run.status === 'completed') break
    if (Date.now() - start > limitMs) throw new Error(`no completed Deploy POCs (preview) run for ${sha} after ${limitMs / 60_000} min`)
    console.error(`waiting for Deploy POCs (preview) on ${sha}: ${run ? run.status : 'not started'}`)
    await new Promise(r => setTimeout(r, 30_000))
  }
  if (run.conclusion !== 'success') console.error(`Deploy POCs (preview) run ${run.databaseId} concluded ${run.conclusion} — using whatever records it uploaded`)
  const out = []
  for (const [app, envName] of [['crouton-builder', 'BUILDER_URL'], ['booking-demo', 'BOOKING_DEMO_URL']]) {
    const dir = mkdtempSync(join(tmpdir(), `meta-${app}-`))
    try { gh(['run', 'download', String(run.databaseId), '--name', `preview-meta-${app}`, '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { throw new Error(`run ${run.databaseId} has no preview-meta-${app} record — its preview did not deploy`) }
    const metaFile = join(dir, 'meta.json')
    const url = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')).url : ''
    if (!url) throw new Error(`preview-meta-${app} has no url`)
    out.push(`${envName}=${String(url).replace(/\/+$/, '')}`)
  }
  console.log(out.join('\n'))
}

function report(argv) {
  const log = arg(argv, 'log')
  const id = arg(argv, 'job', 'run')
  const title = arg(argv, 'title', id)
  const pr = arg(argv, 'pr')
  const runs = parseLines(log && existsSync(log) ? readFileSync(log, 'utf8') : '')
  const section = renderSection(runs, title)
  console.log(section)
  if (!pr) return
  const repo = process.env.GITHUB_REPOSITORY
  const body = JSON.parse(gh(['api', `repos/${repo}/pulls/${pr}`])).body ?? ''
  const file = join(mkdtempSync(join(tmpdir(), 'calscroll-')), 'body.json')
  writeFileSync(file, JSON.stringify({ body: spliceBody(body, id, section) }))
  gh(['api', '-X', 'PATCH', `repos/${repo}/pulls/${pr}`, '--input', file], { stdio: ['ignore', 'ignore', 'inherit'] })
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'preview-urls') return previewUrls(rest)
  if (cmd === 'report') return report(rest)
  throw new Error('usage: calendar-scroll-report.mjs preview-urls|report …')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(e.message); process.exit(1) })
}
