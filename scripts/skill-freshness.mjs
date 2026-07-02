#!/usr/bin/env node
/**
 * Deterministic skill-freshness checker for .claude/skills/ — no LLM, no deps (epic #1100 WS2).
 *
 *   node scripts/skill-freshness.mjs            # concise summary, exit 0 (report-only)
 *   node scripts/skill-freshness.mjs --pretty   # full per-skill breakdown
 *   node scripts/skill-freshness.mjs --json      # machine-readable, for the housekeeping band
 *   node scripts/skill-freshness.mjs --check     # exit 1 ONLY if a skill cites a VANISHED path
 *   git diff --name-only base...HEAD | \
 *     node scripts/skill-freshness.mjs --cite    # JSON: which skills cite the changed paths (WS4)
 *
 * The knowledge-skill library (#1073/#1091) is a set of dated snapshots dense with exactly the
 * facts that drift (versions, counts, ports, paths). WS1 gave each one a machine-parseable
 * provenance contract — a `verified: YYYY-MM-DD` stamp + a fenced re-verify bash block. This
 * checker reads that contract and flags three kinds of drift, purely from `fs` + `git`:
 *
 *   • VANISHED (hard-stale)     — a cited path git history knew about but that is gone from the
 *                                 tree now. A citation pointing at a deleted file is a broken
 *                                 link; this is the one category `--check` will fail on.
 *   • POSSIBLY-STALE            — a cited FILE that still exists but has commits dated newer than
 *                                 the skill's stamp (its content may have moved on since verified).
 *   • RE-VERIFY DUE             — the stamp itself is > STALE_DAYS (default 90d) old.
 *
 * "Cited repo paths" are backtick-quoted, path-shaped tokens (contain a `/` or a known source
 * extension, no glob/placeholder chars). A token only counts as a citation if it resolves on
 * disk OR git history knows it — that git-history gate is how we honour the WS1 rule that cited
 * paths were "verified to exist at authoring time" WITHOUT false-positiving on the many
 * placeholder/example/glob paths in the prose (`layers/<layer>/...`, `/api/teams/[id]/...`).
 *
 * Report-only by design (the epic's rejected alternatives: no blocking CI gate on age, no
 * scheduled LLM re-audit). `computeSkillFreshness()` is exported so housekeeping/gather.mjs can
 * surface a "📚 Skill freshness" band on the same rails (#1100 WS3).
 *
 * Env:
 *   SKILL_STALE_DAYS   default 90 — stamp age (days) past which a skill is "re-verify due"
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(ROOT, '.claude/skills')
const DEFAULT_STALE_DAYS = Number(process.env.SKILL_STALE_DAYS || 90)

// Source-file extensions a bare backtick token must carry to be considered a repo path when it
// has no slash. (A slash alone also qualifies — most citations are `dir/file`.)
const EXT_RE = /\.(mjs|cjs|mts|cts|ts|tsx|js|jsx|json|jsonc|md|mdx|vue|sh|bash|yml|yaml|css|scss|sass|less|html|txt|sql|toml|env|lock)$/
// Chars that mark a token as a glob / placeholder / example, never a literal repo path.
const PLACEHOLDER_RE = /[<>*[\]{}()|$?!~=…\s]/

// ── git helpers (repo-global answers cached across skills) ────────────────────
const gitCache = new Map()
function git(args, root) {
  try {
    return execSync(`git ${args}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}
/** ISO date (YYYY-MM-DD) of the most recent commit touching `path`, or '' if git knows nothing. */
function lastCommitDate(path, root) {
  const key = `d:${path}`
  if (gitCache.has(key)) return gitCache.get(key)
  const out = git(`log -1 --format=%cI -- "${path}"`, root)
  const v = out ? out.slice(0, 10) : ''
  gitCache.set(key, v)
  return v
}
/**
 * True if git history in this (possibly shallow) clone has ever recorded `path`.
 * `--full-history` is required: a plain `git log -- path` applies history simplification and
 * silently drops a file that was added then later removed (TREESAME to HEAD at both ends), which
 * is exactly the vanished-citation case we need to catch.
 */
function gitKnows(path, root) {
  const key = `k:${path}`
  if (gitCache.has(key)) return gitCache.get(key)
  const v = git(`log --full-history --oneline -1 -- "${path}"`, root) !== ''
  gitCache.set(key, v)
  return v
}

// ── date helpers ──────────────────────────────────────────────────────────────
const DAY = 86400000
const isoDay = (d) => d.toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.floor((Date.parse(a) - Date.parse(b)) / DAY)

// ── path extraction ───────────────────────────────────────────────────────────
/**
 * Pull candidate repo-path citations out of a SKILL.md. Tokens live in backtick spans; a span
 * may be a whole shell command, so we split on whitespace and test each word. Returns a deduped
 * list of concrete, path-shaped tokens (existence/history is judged later).
 */
export function extractCitedPaths(text) {
  const spans = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  const seen = new Set()
  for (const span of spans) {
    for (const raw of span.split(/\s+/)) {
      const tok = normalizeToken(raw)
      if (tok) seen.add(tok)
    }
  }
  return [...seen]
}

function normalizeToken(raw) {
  // Strip markdown / prose punctuation clinging to the ends, keep internal dots+slashes.
  let t = raw.replace(/^['"(]+/, '').replace(/[),.;:'"]+$/, '')
  if (!t) return null
  if (PLACEHOLDER_RE.test(t)) return null          // glob / placeholder / example
  if (/^[@#/-]/.test(t)) return null                // npm scope, nuxt alias, absolute/route, flag
  if (/^\.[a-z0-9]+$/i.test(t)) return null          // bare extension like `.vue`
  const hasSlash = t.includes('/')
  if (!hasSlash && !EXT_RE.test(t)) return null      // needs a slash OR a source extension
  return t
}

// ── per-skill classification ──────────────────────────────────────────────────
function parseStamp(text) {
  const m = text.match(/^verified:\s*(\d{4}-\d{2}-\d{2})\s*$/m)
  return m ? m[1] : null
}
const hasProvenanceSection = (text) => /^#{1,6}\s*Provenance and maintenance\s*$/im.test(text)

function classifySkill({ name, file, text, today, staleDays, root }) {
  const stamp = parseStamp(text)
  // Not a provenance-carrying knowledge skill → out of scope for freshness tracking.
  if (!stamp) {
    return hasProvenanceSection(text)
      ? { name, file, tracked: true, malformed: true, reason: 'Provenance section present but no parseable `verified: YYYY-MM-DD` stamp' }
      : { name, file, tracked: false }
  }

  const ageDays = daysBetween(today, stamp)
  const overdue = ageDays > staleDays

  const vanished = []
  const possiblyStale = []
  let citationCount = 0

  for (const path of extractCitedPaths(text)) {
    const abs = join(root, path)
    if (existsSync(abs)) {
      citationCount++
      // Directories churn constantly (a dir's "last commit" is almost always recent), so a dir
      // is never "possibly-stale" — only a concrete FILE citation carries that signal.
      let isFile = false
      try { isFile = statSync(abs).isFile() } catch { /* race — treat as non-file */ }
      if (isFile) {
        const last = lastCommitDate(path, root)
        if (last && last > stamp) possiblyStale.push({ path, lastCommit: last })
      }
    } else if (gitKnows(path, root)) {
      // Concrete path git history recorded, now absent → the citation points at a deleted file.
      citationCount++
      vanished.push(path)
    }
    // else: never-tracked token (placeholder/example/shorthand) → not a citation, skip.
  }

  possiblyStale.sort((a, b) => a.path.localeCompare(b.path))
  vanished.sort()
  return { name, file, tracked: true, malformed: false, stamp, ageDays, overdue, citationCount, vanished, possiblyStale }
}

// ── discovery ─────────────────────────────────────────────────────────────────
function discoverSkillFiles(skillsDir) {
  const out = []
  for (const entry of readdirSync(skillsDir)) {
    const p = join(skillsDir, entry)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) {
      const f = join(p, 'SKILL.md')
      if (existsSync(f)) out.push({ name: entry, file: f })
    } else if (entry.endsWith('.md')) {
      out.push({ name: entry.replace(/\.md$/, ''), file: p })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// ── public API ────────────────────────────────────────────────────────────────
/**
 * Compute skill-freshness for every provenance-stamped skill. Pure fs+git; safe to import.
 * @param {{ root?: string, skillsDir?: string, today?: string, staleDays?: number }} [opts]
 */
export function computeSkillFreshness(opts = {}) {
  const root = opts.root || ROOT
  const skillsDir = opts.skillsDir || join(root, '.claude/skills')
  const today = opts.today || isoDay(new Date())
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS

  const shallow = git('rev-parse --is-shallow-repository', root) === 'true'
  const all = discoverSkillFiles(skillsDir).map((s) =>
    classifySkill({ ...s, text: readFileSync(s.file, 'utf8'), today, staleDays, root })
  )

  const skills = all.filter((s) => s.tracked)
  const malformed = skills.filter((s) => s.malformed)
  const stamped = skills.filter((s) => !s.malformed)
  const summary = {
    scanned: all.length,
    tracked: skills.length,
    malformed: malformed.length,
    vanished: stamped.reduce((n, s) => n + s.vanished.length, 0),
    possiblyStale: stamped.reduce((n, s) => n + s.possiblyStale.length, 0),
    overdue: stamped.filter((s) => s.overdue).length
  }
  return { today, staleDays, shallow, summary, skills: stamped, malformed }
}

const hasIssues = (s) => s.vanished.length || s.possiblyStale.length || s.overdue

/**
 * Given a set of changed repo-relative paths (e.g. a PR's diff), return the stamped skills that
 * CITE one of them — the input to the advisory PR signal (#1100 WS4). Deterministic, no git.
 *
 * A skill cites a changed file when one of its extracted path tokens either exactly equals the
 * changed path (a FILE citation) or is a directory prefix of it (a DIR citation) — but a dir
 * token must be ≥3 segments deep so broad tokens like `packages/` or `apps/` don't firehose
 * every PR. File vs dir is inferred from the source extension (files carry one; dir citations
 * don't).
 * @param {string[]} changedPaths
 * @param {{ root?: string, skillsDir?: string, today?: string }} [opts]
 */
export function computeCitingSkills(changedPaths, opts = {}) {
  const root = opts.root || ROOT
  const skillsDir = opts.skillsDir || join(root, '.claude/skills')
  const today = opts.today || isoDay(new Date())
  const changed = [...new Set(changedPaths.map((p) => p.trim()).filter(Boolean))]

  const segs = (t) => t.replace(/\/+$/, '').split('/').length
  const isDirToken = (t) => !EXT_RE.test(t.replace(/\/+$/, ''))
  const matchesToken = (cp, tok) => {
    const t = tok.replace(/\/+$/, '')
    if (cp === t) return true
    return isDirToken(tok) && segs(tok) >= 3 && cp.startsWith(t + '/')
  }

  const out = []
  for (const { name, file } of discoverSkillFiles(skillsDir)) {
    const text = readFileSync(file, 'utf8')
    const stamp = parseStamp(text)
    if (!stamp) continue // only provenance-stamped skills carry a re-verify contract
    const tokens = extractCitedPaths(text)
    const matched = changed.filter((cp) => tokens.some((tok) => matchesToken(cp, tok)))
    if (matched.length) out.push({ name, stamp, ageDays: daysBetween(today, stamp), matched: matched.sort() })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Read newline-separated paths from stdin (for the `--cite` CI pipe). */
function readStdinLines() {
  try {
    return readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (runDirectly) {
  const argv = process.argv.slice(2)

  // --cite: map changed paths (positional args, else newline-separated stdin) → citing skills.
  // Emits JSON for the advisory PR workflow (#1100 WS4). No git; purely token-vs-path matching.
  if (argv.includes('--cite')) {
    const positional = argv.filter((a) => !a.startsWith('--'))
    const changed = positional.length ? positional : readStdinLines()
    const skills = computeCitingSkills(changed)
    process.stdout.write(JSON.stringify({ today: isoDay(new Date()), changed: changed.length, skills }, null, 2) + '\n')
    process.exit(0)
  }

  const result = computeSkillFreshness()
  const { today, staleDays, shallow, summary, skills, malformed } = result

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    process.exit(0)
  }

  const flagged = skills.filter(hasIssues)
  const pretty = argv.includes('--pretty')

  console.log(`📚 Skill freshness — ${today} (stamp horizon ${staleDays}d)`)
  console.log(
    `   ${summary.tracked} stamped skill(s) · ${summary.vanished} vanished · ` +
      `${summary.possiblyStale} possibly-stale · ${summary.overdue} re-verify due` +
      (summary.malformed ? ` · ${summary.malformed} malformed` : '')
  )
  if (shallow && summary.vanished === 0) {
    console.log('   ⚠️  shallow clone — vanished-path detection is limited to history in this checkout')
  }

  for (const s of malformed) console.log(`\n⚠️  /${s.name} — ${s.reason}`)

  const show = pretty ? skills : flagged
  for (const s of show) {
    const badge = s.vanished.length ? '🔴' : s.possiblyStale.length ? '🟡' : s.overdue ? '🔵' : '🟢'
    console.log(`\n${badge} /${s.name} — stamped ${s.stamp} (${s.ageDays}d ago), ${s.citationCount} citation(s)`)
    if (s.overdue) console.log(`   🔵 re-verify due: stamp is ${s.ageDays}d old (> ${staleDays}d)`)
    for (const p of s.vanished) console.log(`   🔴 vanished: \`${p}\` — cited path no longer exists`)
    for (const { path, lastCommit } of s.possiblyStale)
      console.log(`   🟡 possibly-stale: \`${path}\` — commit ${lastCommit} newer than stamp ${s.stamp}`)
    if (pretty && !hasIssues(s)) console.log('   🟢 fresh')
  }

  if (!pretty && !flagged.length && !malformed.length) console.log('\n✨ All stamped skills are fresh.')

  // `--check`: fail ONLY on a broken citation (vanished path). Age + drift stay signals, never a
  // build failure — the epic explicitly rejects a blocking gate on staleness.
  if (argv.includes('--check')) {
    if (summary.vanished > 0) {
      console.error(
        `\n✗ ${summary.vanished} vanished citation(s) across ${flagged.filter((s) => s.vanished.length).length} skill(s). ` +
          `Re-verify and re-stamp, or fix the path.`
      )
      process.exit(1)
    }
    console.log('\n✓ No broken (vanished) skill citations.')
  }
}
