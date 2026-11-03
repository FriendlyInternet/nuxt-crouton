#!/usr/bin/env node
/**
 * Deterministic weekly gather for the quality digest (#3063) — no LLM, no deps.
 *
 *   GITHUB_TOKEN=... node scripts/quality-digest/gather.mjs [--since YYYY-MM-DD] [--until YYYY-MM-DD]
 *
 * Reads what the pipeline merged in the window (default: the last 7 days) and writes
 * writeups/reports/quality-digest-YYYYMMDD.json (dated by --until). Read-only: it never
 * mutates an issue, PR or branch. Mirrors the housekeeping digest's gather shape.
 *
 * Env: GITHUB_TOKEN (required), DIGEST_REPO (default FriendlyInternet/nuxt-crouton).
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── pure helpers (unit-tested) ────────────────────────────────────────────────

const PIPELINE_PREFIXES = ['.github/', 'scripts/', 'pocs/status/', '.claude/']
const PRODUCT_PREFIXES = ['packages/', 'apps/', 'fixtures/', 'e2e/']
const BOT_AUTHORS = new Set(['nuxt-harness[bot]', 'claude[bot]', 'github-actions[bot]'])

/** `pipeline` / `product` by where most changed lines are; anything else is `other`. */
export function classifyArea(files) {
  const tally = { pipeline: 0, product: 0, other: 0 }
  for (const f of files) {
    const lines = (f.additions || 0) + (f.deletions || 0)
    const name = f.filename || f.path || ''
    if (PIPELINE_PREFIXES.some((p) => name.startsWith(p))) tally.pipeline += lines
    else if (PRODUCT_PREFIXES.some((p) => name.startsWith(p))) tally.product += lines
    else tally.other += lines
  }
  const max = Math.max(tally.pipeline, tally.product, tally.other)
  if (max === 0) return 'other'
  if (tally.pipeline === max) return 'pipeline'
  if (tally.product === max) return 'product'
  return 'other'
}

/** `leaf` = work-*, fix/*; `epic` = epic/*; anything else null (not counted as a leaf). */
export function classifyKind(head) {
  if (/^epic\//.test(head)) return 'epic'
  if (/^(work-|fix\/)/.test(head)) return 'leaf'
  return null
}

const countMatching = (bodies, needle) => bodies.filter((b) => (b || '').includes(needle)).length

/** The per-PR counters read straight off the PR's comment bodies. */
export function countComments(bodies) {
  return {
    reviseRounds: countMatching(bodies, '**Worker:**'),
    fixBotRefusals: countMatching(bodies, 'Auto-fix not pushed'),
    testsMissingDraft: countMatching(bodies, 'tests: MISSING') > 0,
    visualEvidenceMissing: countMatching(bodies, 'visual evidence: MISSING') > 0
  }
}

export const touchesClaudeMd = (paths) => paths.some((p) => p === 'CLAUDE.md' || p.endsWith('/CLAUDE.md'))
export const touchesTests = (paths) => paths.some((p) => /\.(test|spec)\./.test(p) || /(^|\/)tests?\//.test(p))

export const isRevertSubject = (s) => /revert|restore|dropped|undo|wiped/i.test(s)

/** Split a workflow into jobs → steps with a tiny indentation parser (no YAML dependency). */
export function parseWorkflow(text) {
  const lines = text.split('\n')
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (jobsAt < 0) return []
  const jobs = []
  let job = null
  for (const line of lines.slice(jobsAt + 1)) {
    if (/^\S/.test(line)) break // left the jobs: block
    const j = line.match(/^ {2}([\w-]+):\s*$/)
    if (j) {
      job = { name: j[1], lines: [] }
      jobs.push(job)
    } else if (job) job.lines.push(line)
  }
  return jobs.map((jb) => ({ name: jb.name, steps: splitSteps(jb.lines) }))
}

function splitSteps(lines) {
  const at = lines.findIndex((l) => /^\s*steps:\s*$/.test(l))
  if (at < 0) return []
  const rest = lines.slice(at + 1)
  const first = rest.find((l) => /^\s*- /.test(l))
  if (!first) return []
  const indent = first.match(/^(\s*)- /)[1].length
  const steps = []
  for (const line of rest) {
    if (new RegExp(`^ {${indent}}- `).test(line)) steps.push([line.replace(/^(\s*)- /, '$1  ')])
    else if (steps.length) steps[steps.length - 1].push(line)
  }
  return steps.map((l) => l.join('\n'))
}

const field = (step, key) => {
  const m = step.match(new RegExp(`^\\s*${key}:[ \\t]*(.*)$`, 'm'))
  return m ? m[1].trim() : ''
}
// A `pi`/`claude` invocation in command position of a run: line (comments and prose don't count).
const runsModel = (step) => {
  const run = step.match(/^\s*run:\s*(\|[^\n]*\n[\s\S]*|[^\n]*)/m)?.[1] || ''
  return run
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .some((l) => /(^|[|;&(`]|\$\(|\brun:|\|)\s*(pnpm exec |npx )?(pi|claude)(\s|$)/.test(l.replace(/^\s*\|\s*$/, '')))
}

const runOf = (step) => step.match(/^\s*run:\s*(\|[^\n]*\n[\s\S]*|[^\n]*)/m)?.[1] || ''

const uploadsDbPaths = (step) => {
  if (!/uses:\s*actions\/upload-artifact@/.test(step)) return false
  const path = step.match(/^\s*path:\s*(\|[^\n]*\n(?:\s{2,}[^\n]*\n?)*|[^\n]*)/m)?.[1] || ''
  return /backup|dump|export|\.sql/i.test(path)
}
const isFailOpenGate = (step) =>
  /^\s*continue-on-error:\s*true\b/m.test(step) && /review|verdict|gate/i.test(field(step, 'name'))
const interpolatesComment = (step) => runOf(step).includes('github.event.comment.body')
const modelWithCredentials = (job) =>
  job.steps.some(runsModel) &&
  job.steps
    .filter((s) => /uses:\s*actions\/checkout@/.test(s))
    .some((s) => !/persist-credentials:\s*false/.test(s))

const stepChecks = [
  ['artifactUploadsWithDbPaths', uploadsDbPaths],
  ['failOpenGates', isFailOpenGate],
  ['commentBodyInRun', interpolatesComment]
]

const scanJob = (name, job, out) => {
  for (const step of job.steps) {
    const where = { workflow: name, job: job.name, step: field(step, 'name') || field(step, 'uses') }
    for (const [key, check] of stepChecks) if (check(step)) out[key].push(where)
  }
  if (modelWithCredentials(job)) out.modelJobsWithCredentials.push({ workflow: name, job: job.name })
}

/** The four deterministic security scans over `[{name, text}]` workflow files. */
export function scanWorkflows(files) {
  const out = {
    artifactUploadsWithDbPaths: [],
    modelJobsWithCredentials: [],
    commentBodyInRun: [],
    failOpenGates: []
  }
  for (const { name, text } of files) {
    for (const job of parseWorkflow(text)) scanJob(name, job, out)
  }
  return out
}

// ── gather (network + git) ────────────────────────────────────────────────────

const ymd = (d) => d.toISOString().slice(0, 10)
export function parseArgs(argv, now = new Date()) {
  const arg = (k) => {
    const i = argv.indexOf(k)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const until = arg('--until') || ymd(now)
  const since = arg('--since') || ymd(new Date(Date.parse(until) - 7 * 86400000))
  return { since, until }
}

async function main() {
  const REPO = process.env.DIGEST_REPO || 'FriendlyInternet/nuxt-crouton'
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error('gather.mjs: GITHUB_TOKEN is required')
    process.exit(1)
  }
  const { since, until } = parseArgs(process.argv.slice(2))

  const gh = async (path) => {
    const res = await fetch('https://api.github.com' + path, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'quality-digest'
      }
    })
    if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`)
    return res.json()
  }
  const paged = async (path) => {
    const all = []
    for (let page = 1; page <= 20; page++) {
      const items = await gh(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      all.push(...items)
      if (items.length < 100) break
    }
    return all
  }
  const search = async (q) => {
    const all = []
    for (let page = 1; page <= 10; page++) {
      const r = await gh(`/search/issues?per_page=100&page=${page}&q=${encodeURIComponent(q)}`)
      all.push(...(r.items || []))
      if ((r.items || []).length < 100) break
    }
    return all
  }

  // PRs merged in the window
  const found = await search(`repo:${REPO} is:pr is:merged merged:${since}..${until}`)
  const prs = []
  for (const hit of found) {
    const pr = await gh(`/repos/${REPO}/pulls/${hit.number}`)
    const kind = classifyKind(pr.head.ref)
    if (!kind) continue
    const files = await paged(`/repos/${REPO}/pulls/${hit.number}/files`)
    const comments = await paged(`/repos/${REPO}/issues/${hit.number}/comments`)
    const paths = files.map((f) => f.filename)
    prs.push({
      number: pr.number,
      title: pr.title,
      merged_at: pr.merged_at,
      head: pr.head.ref,
      base: pr.base.ref,
      author: pr.user?.login,
      kind,
      area: classifyArea(files),
      additions: pr.additions,
      deletions: pr.deletions,
      files: pr.changed_files,
      ...countComments(comments.map((c) => c.body)),
      claudeMdTouched: touchesClaudeMd(paths),
      testFilesTouched: touchesTests(paths)
    })
  }

  // Commits landed on main in the window
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const range = [`--since=${since}T00:00:00Z`, `--until=${until}T00:00:00Z`, '--no-merges']
  let log = ''
  try {
    log = git(['log', 'origin/main', ...range, '--format=@@%an%x09%s', '--name-only'])
  } catch {
    log = git(['log', 'HEAD', ...range, '--format=@@%an%x09%s', '--name-only'])
  }
  const byAuthor = {}
  let revertLike = 0
  const handAuthored = []
  let total = 0
  for (const block of log.split('@@').slice(1)) {
    const [head, ...rest] = block.split('\n')
    const [author, ...subj] = head.split('\t')
    const subject = subj.join('\t')
    const paths = rest.filter(Boolean)
    total++
    byAuthor[author] = (byAuthor[author] || 0) + 1
    if (isRevertSubject(subject)) revertLike++
    if (!BOT_AUTHORS.has(author) && paths.some((p) => /^(packages|apps)\//.test(p)))
      handAuthored.push({ author, subject })
  }

  // Postmortems on epics closed in the window
  const epics = await search(`repo:${REPO} is:issue label:epic is:closed closed:${since}..${until}`)
  const postmortems = []
  for (const e of epics) {
    const cs = await paged(`/repos/${REPO}/issues/${e.number}/comments`)
    postmortems.push({
      number: e.number,
      title: e.title,
      done: cs.some((c) => (c.body || '').includes('postmortem:done'))
    })
  }

  const incidents = (await search(`repo:${REPO} is:issue label:workflow created:${since}..${until}`)).map((i) => ({
    number: i.number,
    title: i.title
  }))

  const wfDir = '.github/workflows'
  const scans = scanWorkflows(
    readdirSync(wfDir)
      .filter((f) => f.endsWith('.yml'))
      .map((f) => ({ name: f, text: readFileSync(`${wfDir}/${f}`, 'utf8') }))
  )

  const data = {
    generatedAt: new Date().toISOString(),
    window: { since, until },
    prs,
    main: { commits: total, byAuthor, revertLike, handAuthoredProductCommits: handAuthored },
    postmortems,
    incidents,
    scans
  }
  mkdirSync('writeups/reports', { recursive: true })
  const out = `writeups/reports/quality-digest-${until.replace(/-/g, '')}.json`
  writeFileSync(out, JSON.stringify(data, null, 2) + '\n')

  const leaves = prs.filter((p) => p.kind === 'leaf')
  const areas = (a) => leaves.filter((p) => p.area === a).length
  console.log(
    `${leaves.length} leaf PRs (${areas('pipeline')} pipeline / ${areas('product')} product / ${areas('other')} other), ` +
      `${prs.length - leaves.length} epic PRs → ${out}`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
