#!/usr/bin/env node
// new-ticket.mjs — file ONE standalone ticket through the same gates the pipeline applies (#3209).
//
//   node scripts/new-ticket.mjs --title "..." --body-file body.md [--parent N] [--type type:feat]
//        [--label a,b] [--trigger work-this] [--force] [--dry-run]
//
// Rule: the trigger label is added LAST, only after every check passed and the issue is created and
// linked. It composes existing helpers (epic-scaffold, test-card, packages-guard, apply-decompose-plan);
// it adds no second schema. REST only (`gh api`), so it works in interactive sessions too.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from './lib/cli-args.mjs'
import { DEDUP_RE, NO_TEST_STEPS_MSG } from './epic-scaffold.mjs'
import { hasTestSteps } from './test-card.mjs'
import { ATTESTATION_RE } from './packages-guard.mjs'
import { writePipelineBlock, resolveContext } from './pipeline-context.mjs'
import { ghCreateIssue, ghAddLabel, deferHandoff, sanitizeLabels } from './apply-decompose-plan.mjs'

export const DEFAULT_TRIGGER = 'work-this'
const STOPWORDS = new Set('a an and are as at be by for from in into is it of on or the to with add new use via when that this make'.split(' '))
const PATH_LABELS = [['packages', 'pkg'], ['apps', 'app'], ['workers', 'worker']]

/** Label names declared in .github/labels.yml (`- name: "x"`). */
export function parseLabelNames(yml = '') {
  return [...yml.matchAll(/^\s*-\s*name:\s*["']?([^"'\n]+?)["']?\s*$/gm)].map(m => m[1])
}

/** The body of the `For agents` section (to the next heading of the same or higher level), or ''. */
export function forAgentsSection(body = '') {
  const lines = body.split('\n')
  const start = lines.findIndex(l => /^#{1,6}\s*(?:\S+\s+)?For agents\b/i.test(l))
  if (start < 0) return ''
  const level = lines[start].match(/^#+/)[0].length
  const out = []
  for (const l of lines.slice(start + 1)) {
    const m = l.match(/^(#{1,6})\s/)
    if (m && m[1].length <= level) break
    out.push(l)
  }
  return out.join('\n')
}

/** `pkg:`/`app:`/`worker:` labels for the paths the `For agents` section names (paths elsewhere add nothing). Unknown ones become warnings, never labels. */
export function labelsFor(fullBody = '', known = []) {
  const body = forAgentsSection(fullBody)
  const labels = [], warnings = []
  for (const [dir, prefix] of PATH_LABELS) {
    const names = new Set([...body.matchAll(new RegExp(`\\b${dir}/([a-z0-9][a-z0-9._-]*)`, 'gi'))].map(m => m[1].toLowerCase().replace(/[._-]+$/, '')))
    for (const n of names) {
      const label = `${prefix}:${n}`
      if (known.includes(label)) labels.push(label)
      else warnings.push(`no label ${label} in .github/labels.yml — not applied`)
    }
  }
  return { labels, warnings }
}

/** Pure body check → { errors, warnings, labels }. */
export function checkBody(body = '', known = []) {
  const errors = [], warnings = []
  if (!DEDUP_RE.test(body)) warnings.push('body has no `Dedup-checked:` line')
  if (!hasTestSteps(body)) errors.push(NO_TEST_STEPS_MSG.replace('epic body', 'ticket body'))
  if (/\bpackages\//.test(body) && !ATTESTATION_RE.test(body)) {
    warnings.push('body names `packages/…` but has no `Packages-approved:` line — a package edit needs the owner’s scoped approval')
  }
  if (!/^#{1,6}\s*(?:\S+\s+)?Hypothesis/im.test(body)) warnings.push('no `## Hypothesis` section (fine for trivial chores)')
  const l = labelsFor(body, known)
  return { errors, warnings: [...warnings, ...l.warnings], labels: l.labels }
}

/** 3–4 keyword queries from a title: stop-words dropped, longest words first. */
export function dedupQueries(title = '') {
  const words = [...new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOPWORDS.has(w)))]
    .sort((a, b) => b.length - a.length)
  return words.slice(0, 4)
}

/** Search open issues per keyword; returns unique hits [{number,title}]. */
export function findDuplicates(queries, { repo, exec }) {
  const hits = new Map()
  for (const q of queries) {
    const out = exec('gh', ['api', '-X', 'GET', 'search/issues', '-f', `q=repo:${repo} is:issue is:open ${q}`, '-q', '.items[:5][]|"\(.number)\t\(.title)"'])
    for (const line of String(out || '').split('\n').filter(Boolean)) {
      const [number, ...t] = line.split('\t')
      hits.set(number, { number: Number(number), title: t.join('\t') })
    }
  }
  return [...hits.values()]
}

/**
 * Run all checks, then (unless dryRun) create → label → link → trigger LAST.
 * Returns { ok, exitCode, errors, warnings, labels, hits, number? }.
 */
export function newTicket(opts, { exec, repo, knownLabels = [], log = console.error, writeBody = defaultWriteBody } = {}) {
  const { title, parent, type = 'type:feat', extraLabels = [], trigger = DEFAULT_TRIGGER, force = false, dryRun = false } = opts
  let body = opts.body || ''
  const out = { ok: false, exitCode: 1, errors: [], warnings: [], labels: [], hits: [] }
  if (!title) { out.errors.push('--title is required'); return out }
  const queries = dedupQueries(title)
  if (body && !DEDUP_RE.test(body) && queries.length) body = `${body.trimEnd()}\n\nDedup-checked: ${queries.join(', ')}\n`
  const check = checkBody(body, knownLabels)
  out.errors = check.errors
  out.warnings = check.warnings
  const wanted = [type, ...extraLabels, ...check.labels]
  const { kept, dropped } = sanitizeLabels([...new Set(wanted)], knownLabels)
  out.labels = kept
  for (const d of dropped) out.warnings.push(`unknown label ${d} — dropped`)
  if (out.errors.length) return out

  out.hits = findDuplicates(queries, { repo, exec })
  if (out.hits.length && !force) {
    out.errors.push(`possible duplicates (re-run with --force to file anyway): ${out.hits.map(h => `#${h.number} ${h.title}`).join('; ')}`)
    return out
  }
  if (dryRun) { out.ok = true; out.exitCode = 0; return out }

  const number = ghCreateIssue(exec, repo, { title, file: writeBody(body), labels: kept })
  out.number = number
  if (parent) {
    const err = inheritParentContext({ exec, repo, parent, number, body, log, writeBody })
    if (err) { out.errors.push(err); return out }
    linkToParent({ exec, repo, parent, number })
  }
  // LAST: only now may the pipeline pick it up. deferHandoff records a rate-limited add for the hourly replay.
  deferHandoff(exec, { kind: 'label', issue: number, label: trigger }, () => ghAddLabel(exec, repo, number, trigger), { pending: [], log })
  log(`filed #${number}`)
  out.ok = true
  out.exitCode = 0
  return out
}

/** Inherit the parent's epic context (the number only exists now, so edit the body after creating). Returns an error string or null. */
function inheritParentContext({ exec, repo, parent, number, body, log, writeBody }) {
  const parentBody = exec('gh', ['api', `repos/${repo}/issues/${parent}`, '-q', '.body'])
  const ctx = resolveContext({ issue: { body }, parent: { body: parentBody }, parentNumber: parent })
  if (!ctx) {
    log(`parent #${parent} is an umbrella (no epic branch) — #${number} is its own epic`)
    // Plan step 3: stamp the umbrella child as its own depth-0 epic (no branch yet).
    try {
      exec('gh', ['api', '--method', 'PATCH', `repos/${repo}/issues/${number}`, '-F', `body=@${writeBody(writePipelineBlock(body, { epic: number, depth: 0 }))}`])
    } catch (e) {
      return `could not add the pipeline: line to #${number} (${e.message}) — trigger label NOT added`
    }
    return null
  }
  try {
    exec('gh', ['api', '--method', 'PATCH', `repos/${repo}/issues/${number}`, '-F', `body=@${writeBody(writePipelineBlock(body, ctx))}`])
  } catch (e) {
    return `could not add the pipeline: line to #${number} (${e.message}) — trigger label NOT added`
  }
  return null
}

function linkToParent({ exec, repo, parent, number }) {
  const restId = exec('gh', ['api', `repos/${repo}/issues/${number}`, '-q', '.id'])
  exec('gh', ['api', '--method', 'POST', `repos/${repo}/issues/${parent}/sub_issues`, '-F', `sub_issue_id=${restId}`])
}

function defaultWriteBody(body) {
  const f = join(mkdtempSync(join(tmpdir(), 'new-ticket-')), 'body.md')
  writeFileSync(f, body)
  return f
}

function realExec(file, args, input) {
  return execFileSync(file, args, { input, encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 }).trim()
}

function main(argv) {
  const f = parseArgs(argv, { boolean: ['force', 'dry-run'] })
  if (!f.title || !f['body-file']) { console.error('usage: new-ticket.mjs --title T --body-file F [--parent N] [--type L] [--label a,b] [--trigger L] [--force] [--dry-run]'); return 2 }
  const repo = process.env.GITHUB_REPOSITORY || realExec('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
  const knownLabels = parseLabelNames(readFileSync(new URL('../.github/labels.yml', import.meta.url), 'utf8'))
  const labelFlag = argv.flatMap((a, i) => (a === '--label' && argv[i + 1] ? argv[i + 1].split(',') : []))
  const res = newTicket({
    title: f.title, body: readFileSync(f['body-file'], 'utf8'), parent: f.parent ? Number(f.parent) : undefined,
    type: typeof f.type === 'string' ? f.type : undefined, extraLabels: labelFlag,
    trigger: typeof f.trigger === 'string' ? f.trigger : undefined, force: !!f.force, dryRun: !!f['dry-run'],
  }, { exec: realExec, repo, knownLabels })
  for (const w of res.warnings) console.error(`⚠️  ${w}`)
  for (const e of res.errors) console.error(`❌ ${e}`)
  if (res.ok) console.log(res.number ? `https://github.com/${repo}/issues/${res.number}` : `dry-run ok — labels: ${res.labels.join(', ')}`)
  return res.exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
