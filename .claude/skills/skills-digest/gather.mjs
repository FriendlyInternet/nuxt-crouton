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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { META, GROUPS, discover } from '../../../scripts/gen-skills-doc.mjs'

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

const data = {
  generatedAt: new Date().toISOString(),
  repo: REPO,
  since,
  total: skills.length,
  groups,
  changed
}

process.stdout.write(JSON.stringify(data, null, 2) + '\n')
