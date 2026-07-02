#!/usr/bin/env node
/**
 * Deterministic data-gather for the monthly skills digest — no LLM, no network, no deps (#841).
 *
 *   node gather.mjs > skills.data.json
 *
 * Enumerates every skill in .claude/skills/ (reusing scripts/gen-skills-doc.mjs's discover() +
 * META map as the single source of truth — so the digest and the skills-and-triggers.html doc
 * can never drift), groups them, and computes the "what changed since last digest" delta from
 * `git` history between the previous send date and HEAD. Emits the JSON render.mjs consumes.
 *
 * Env:
 *   DIGEST_REPO    default "FriendlyInternet/nuxt-crouton" (display only)
 *   DIGEST_SINCE   YYYY-MM-DD — the previous digest's send date; the delta window starts here.
 *                  Defaults to one month ago (same day-of-month) when unset.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { META, GROUPS, discover } from '../../../scripts/gen-skills-doc.mjs'
import { computeSkillFreshness } from '../../../scripts/skill-freshness.mjs'
import { usageCoverage } from '../loop-station/advisor.mjs'

const REPO = process.env.DIGEST_REPO || 'FriendlyInternet/nuxt-crouton'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

// ── since-date: the previous digest's send day (one month ago by default) ────
function defaultSince() {
  const n = new Date()
  // Same day-of-month, one month back (UTC); JS clamps invalid days (e.g. Mar 31 → Mar 3),
  // but for a digest window an approximate month boundary is fine.
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, n.getUTCDate()))
    .toISOString()
    .slice(0, 10)
}
const since = process.env.DIGEST_SINCE || defaultSince()

// ── git helpers (degrade gracefully outside a repo / on any git error) ───────
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

// ── shallow-clone guard (#1027) ───────────────────────────────────────────────
// A git-delta producer that diffs history over a time window MUST run on a full clone —
// a shallow one (actions/checkout's default) doesn't have the `since` baseline commit, so
// the delta below would silently come back empty/firstRun=true, indistinguishable from
// "genuinely nothing changed" (the skills-digest went blank every month before #1027 caught
// it). Fail loud instead of shipping a green-but-wrong digest. Only fires inside an actual
// git repo (`git rev-parse --is-shallow-repository` returns null outside one, e.g. a tarball
// checkout) — that case already degrades gracefully below via the existing firstRun fallback.
const shallow = git('rev-parse', '--is-shallow-repository')
if (shallow !== null && shallow.trim() === 'true') {
  console.error(
    'gather.mjs: refusing to compute a git-delta digest from a SHALLOW clone — ' +
      `the \`since\` baseline (${since}) commit isn't reachable, so the delta would silently ` +
      'come back empty. Checkout with `fetch-depth: 0` (see the workflow) and re-run.'
  )
  process.exit(1)
}

// The commit snapshot as of the morning of `since` — the baseline we diff HEAD against.
const sinceRef = (git('rev-list', '-1', `--before=${since} 00:00:00`, 'HEAD') || '').trim()

// Map a path under .claude/skills/ to its skill "key" (folder name, or a top-level *.md's
// basename). A directory only counts as a skill when it carries a SKILL.md — matching discover().
function keyFromPath(line) {
  const rel = line.replace(/^\.claude\/skills\//, '')
  if (rel === line) return null // not under .claude/skills/
  const seg = rel.split('/')[0]
  if (rel === seg && seg.endsWith('.md')) return seg.replace(/\.md$/, '') // top-level skill.md
  if (rel === `${seg}/SKILL.md`) return seg // directory skill (keyed only by its SKILL.md)
  return null
}
function keysAtRef(ref) {
  const out = git('ls-tree', '-r', '--name-only', ref, '--', '.claude/skills')
  const keys = new Set()
  if (out) for (const line of out.split('\n')) {
    const k = keyFromPath(line.trim())
    if (k) keys.add(k)
  }
  return keys
}

// ── current skill set (the source of truth for the list) ─────────────────────
const skills = discover() // [{ name, desc }], already sorted
const bname = new Map(skills.map((s) => [s.name, s])) // name → {name, desc}
const triggersOf = (name) => (META[name]?.triggers?.length ? META[name].triggers : ['ask'])
const groupOf = (name) => META[name]?.group || 'uncategorised'

const groups = GROUPS.map((g) => ({
  id: g.id,
  title: g.title,
  sub: g.sub,
  skills: skills
    .filter((s) => groupOf(s.name) === g.id)
    .map((s) => ({ name: s.name, desc: s.desc, triggers: triggersOf(s.name) }))
})).filter((g) => g.skills.length)

// ── delta: added / updated / removed since `sinceRef` ────────────────────────
let changed = { firstRun: true, added: [], updated: [], removed: [] }
if (sinceRef) {
  const headKeys = keysAtRef('HEAD')
  const sinceKeys = keysAtRef(sinceRef)
  // Files that changed under .claude/skills/ across the window → the keys they belong to.
  const touched = new Set()
  const diff = git('diff', '--name-only', sinceRef, 'HEAD', '--', '.claude/skills')
  if (diff) for (const line of diff.split('\n')) {
    const k = keyFromPath(line.trim())
    if (k) touched.add(k)
  }
  const enrich = (k) => ({ name: k, ...(bname.get(k)?.desc ? { desc: bname.get(k).desc } : {}) })
  const added = [...headKeys].filter((k) => !sinceKeys.has(k))
  const removed = [...sinceKeys].filter((k) => !headKeys.has(k))
  const addedSet = new Set(added)
  const removedSet = new Set(removed)
  const updated = [...touched].filter((k) => !addedSet.has(k) && !removedSet.has(k) && headKeys.has(k))
  const byName = (a, b) => a.localeCompare(b)
  changed = {
    firstRun: false,
    added: added.sort(byName).map(enrich),
    updated: updated.sort(byName).map(enrich),
    removed: removed.sort(byName).map((k) => ({ name: k })) // no current desc for a removed skill
  }
}

// ── loop-station join (#1028 A) ──────────────────────────────────────────────
// Annotate each skill with its MEASURED token cost + redundancy band from the latest
// committed context-budget record (loop-station #926), when present. The digest stays a
// reader/renderer — loop-station is the producer; we never recompute. Degrades to no
// annotations when the record is absent.
function skillNameFromPath(p) {
  const m = String(p).match(/^\.claude\/skills\/(.+)$/)
  if (!m) return null
  const seg = m[1].split('/')[0]
  if (m[1] === seg && seg.endsWith('.md')) return seg.replace(/\.md$/, '') // top-level skill.md
  if (m[1] === `${seg}/SKILL.md`) return seg // directory skill
  return null
}
function loadBudget() {
  const p = join(ROOT, 'writeups/loop-station/history.jsonl')
  if (!existsSync(p)) return null
  let rec
  try {
    const lines = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
    if (!lines.length) return null
    rec = JSON.parse(lines[lines.length - 1])
  } catch {
    return null
  }
  const bandByPath = {}
  for (const o of rec.scorecard?.length?.oversized || []) bandByPath[o.path] = o.band
  const self = rec.redundancy?.selfByPath || {}
  const byName = new Map()
  for (const a of rec.artifacts || []) {
    if (a.kind !== 'skill') continue
    const name = a.name || skillNameFromPath(a.path)
    if (!name) continue
    byName.set(name, { tokens: a.tokens, band: bandByPath[a.path] || 'green', selfRedundancy: self[a.path] ?? 0 })
  }
  // Top restated pairs, skill-vs-skill only, resolved to skill names (the overlap the digest cares about).
  const topPairs = (rec.redundancy?.topPairs || [])
    .map((pr) => ({ a: skillNameFromPath(pr.a), b: skillNameFromPath(pr.b), containment: pr.containment }))
    .filter((pr) => pr.a && pr.b)
    .slice(0, 3)
  return {
    byName,
    summary: {
      total: rec.totals?.tokens,
      skillTokens: rec.totals?.byKind?.skill,
      alwaysOn: rec.totals?.alwaysOnTokens,
      redundancyPct: rec.redundancy?.pct,
      scorecard: rec.scorecard?.overall,
      tokenizer: rec.tokenizer,
      commit: rec.commit ? String(rec.commit).slice(0, 8) : undefined,
      generatedAt: rec.generatedAt,
      topPairs
    }
  }
}
const budget = loadBudget()
if (budget) {
  for (const g of groups) for (const s of g.skills) {
    const b = budget.byName.get(s.name)
    if (b) s.budget = b
  }
}

// ── dead-weight join (#1100 WS5) ─────────────────────────────────────────────
// Cross the SKILL-FRESHNESS signal (scripts/skill-freshness.mjs — cited paths drifted /
// `verified:` stamp aged out) with the USAGE rollup (writeups/loop-station/usage.jsonl, #1064)
// to surface RETIRE CANDIDATES: a stale skill that also never fired. Honours the loop-station
// doctrine — it NEVER judges "unused" blind: usageCoverage() gates the retire verdict, so with
// no rollup (or thin coverage) the band renders freshness-only and says the verdict is withheld.
// Scope is `pipeline` (CI invocations only); interactive session usage isn't measured yet (#1067),
// so the band labels the counts as such and a 0 is "never fired IN CI", not "provably dead".
function loadUsageRecords() {
  const p = join(ROOT, 'writeups/loop-station/usage.jsonl')
  if (!existsSync(p)) return []
  try {
    return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}
function deadWeightJoin() {
  let fresh
  try {
    fresh = computeSkillFreshness({ root: ROOT })
  } catch {
    return null // git/fs unavailable — drop the band rather than guess
  }
  const usageRecords = loadUsageRecords()
  const coverage = usageCoverage(usageRecords)
  const fired = {}
  for (const u of usageRecords) for (const [name, c] of Object.entries(u?.byName || {})) fired[name] = (fired[name] || 0) + (c || 0)

  // "stale" for the retire signal = the hard flags (stamp overdue OR a vanished citation).
  // possibly-stale alone is too soft to imply retirement; it's carried as context only.
  const stale = fresh.skills
    .filter((s) => s.overdue || s.vanished.length)
    .map((s) => ({
      name: s.name,
      stamp: s.stamp,
      ageDays: s.ageDays,
      overdue: s.overdue,
      vanished: s.vanished.length,
      possiblyStale: s.possiblyStale.length,
      invocations: fired[s.name] ?? 0
    }))
    .sort((a, b) => b.ageDays - a.ageDays)

  // Retire-candidate = stale AND zero invocations — ONLY when coverage lets us judge.
  const retireCandidates = coverage.judged ? stale.filter((s) => s.invocations === 0) : []

  return { freshness: fresh.summary, staleDays: fresh.staleDays, stale, coverage, retireCandidates }
}
const deadWeight = deadWeightJoin()

const data = {
  generatedAt: new Date().toISOString(),
  repo: REPO,
  since,
  total: skills.length,
  groups,
  changed,
  budget: budget ? budget.summary : null,
  deadWeight
}

process.stdout.write(JSON.stringify(data, null, 2) + '\n')
