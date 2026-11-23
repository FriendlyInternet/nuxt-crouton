#!/usr/bin/env node
/**
 * Merge-conflict resolution for the revise worker (#2848, reverses the #2658 abort).
 *
 * work-issue-pidev.yml leaves a conflicted base merge IN PROGRESS and hands pi a resolution task.
 * This script owns the two ends of that: the task text (`prompt`) and the hard checks on the
 * result (`verify`) — the effect is asserted (no marker survives, generators are clean), not
 * trusted from an exit code.
 *
 *   node scripts/conflict-resolution.mjs prompt <base> <choice-file>   # task text for pi
 *   node scripts/conflict-resolution.mjs verify <choice-file>          # 0 resolved · 3 choice · 1 failed
 *
 * The generator list lives here, once; the workflow and the prompt both read it.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { failingLines } from './lib/log-tail.mjs'

/** The scripts suite — must match ci.yml's. `node --test scripts/` treats the dir as a module path and fails on Node 22. */
export const SCRIPTS_TEST_CMD = 'node --test scripts/*.test.mjs scripts/lib/*.test.mjs'

/** A conflicted package's tests. `--if-present` must come BEFORE the script name — after it, pnpm passes it to the script (#3900). */
export function packageTestCmd(p) { return `pnpm --filter "./packages/${p}" run --if-present test` }

/**
 * Package tests need the merged branch's workspace links, not main's (#4155); `--ignore-scripts` because they don't need the apps' `nuxt prepare`
 * — and its package builds too: `BUILD_CMD` runs after it when the merge changed packages/ or the lockfile compared with the tree the
 * builds came from (PKG_DIST_REF, #4374).
 */
export const INSTALL_CMD = 'pnpm install --frozen-lockfile --prefer-offline --ignore-scripts'

/** The repo's own package build. `--if-present`: a workspace without the script (the temp-repo tests) does nothing (#4374). */
export const BUILD_CMD = 'pnpm run --if-present build:packages'

/** Does the merge need fresh `packages/*\/dist` builds? Yes when it changed anything under packages/ or the lockfile (#4374). */
export function needsPackageBuild(changed) {
  const hit = changed.find((f) => f.startsWith('packages/') || f === 'pnpm-lock.yaml')
  return hit
    ? { build: true, reason: hit }
    : { build: false, reason: 'the merge changed nothing under packages/ or pnpm-lock.yaml' }
}

/**
 * The files the build decision judges: the working tree against the ref the package builds came from (#4374).
 * A set but unreadable ref builds to be safe — never a quiet fallback to HEAD, which would skip the build.
 */
export function changedSinceBuild({ distRef, cwd } = {}) {
  const diff = (ref) => {
    const r = spawnSync('git', ['diff', '--name-only', ref], { cwd, encoding: 'utf8' })
    return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : null
  }
  if (!distRef) return { files: diff('HEAD') ?? [], against: 'HEAD', note: 'PKG_DIST_REF not set: comparing with HEAD for the package build' }
  const files = diff(distRef)
  if (files) return { files, against: distRef, note: null }
  return {
    files: [`packages/ (build ref ${distRef} unreadable)`],
    against: distRef,
    note: `the package build ref ${distRef} could not be read — building to be safe`,
  }
}

/** The scripts-test failure, naming up to `max` failed tests — never the bare line alone (#4374). */
export function failedTestsNote(output, { max = 5 } = {}) {
  const head = 'scripts tests fail after resolution'
  const found = failingLines(output, { max: Infinity })
  const notOk = /^\s*not ok \d+ - /
  const names = found.filter((l) => notOk.test(l.text)).map((l) => l.text.replace(notOk, ''))
  if (names.length) {
    const more = names.length > max ? [`  and ${names.length - max} more`] : []
    return [`${head}: ${names.length} failed`, ...names.slice(0, max).map((n) => `  ✖ ${n}`), ...more]
  }
  if (found.length) return [head, ...found.slice(0, max).map((l) => `  ${l.text}`)]
  return [`${head} (no failing line found in the test output — see the run log)`]
}

/**
 * The build + test tail of `verify` (#4374). `run(cmd)` → `{ ok, output }`; `log(line)` writes to stderr.
 * `changed` is the build-decision list (changedSinceBuild); `conflicted` picks the packages whose tests run.
 */
export function runChecks({ changed, conflicted, run, log }) {
  const need = needsPackageBuild(changed)
  let installed = false
  if (need.build) {
    if (!run(INSTALL_CMD).ok) return { ok: false, errors: ['install for the merged branch failed — package build not run'] }
    installed = true
    const b = run(BUILD_CMD)
    if (!b.ok) return { ok: false, errors: ['package build failed after the merge — tests not run', ...failingLines(b.output, { max: 5 }).map((l) => `  ${l.text}`)] }
    log(`package build: ${need.reason}`)
  } else {
    log(`package build skipped: ${need.reason}`)
  }
  const t = run(SCRIPTS_TEST_CMD)
  if (!t.ok) return { ok: false, errors: failedTestsNote(t.output) }
  const pkgs = [...new Set(conflicted.map((f) => f.match(/^packages\/([^/]+)\//)?.[1]).filter(Boolean))]
  if (pkgs.length && !installed && !run(INSTALL_CMD).ok) return { ok: false, errors: ['install for the merged branch failed — package tests not run'] }
  for (const p of pkgs) if (!run(packageTestCmd(p)).ok) return { ok: false, errors: [`${p} tests fail after resolution`] }
  return { ok: true }
}

/**
 * Files a generator produces are regenerated, never hand-merged. `inputs` + `outputs` are exact paths or prefixes.
 * Migrations are a per-app generator too, handled by checkMigrationResolution below (the app is found from the path,
 * so it is not in this list). Keep this file's imports node:-only, plus exactly ./lib/log-tail.mjs (itself import-free), which the
 * workflow copies beside the lone copy (#4320; exception added by #4374 to reuse failingLines — guarded by T5a/T13).
 */
export const GENERATORS = [
  {
    name: 'gen-routing',
    touches: ['.claude/routing.json', 'writeups/architecture/routing-registry.md'],
    run: 'node scripts/gen-routing.mjs',
    check: 'node scripts/gen-routing.mjs --check',
  },
  {
    name: 'gen-skills-doc',
    touches: ['.claude/skills/', 'writeups/architecture/skills-and-triggers.html'],
    run: 'node scripts/gen-skills-doc.mjs',
    check: 'node scripts/gen-skills-doc.mjs --check',
  },
  {
    name: 'gen-package-catalog',
    touches: ['.claude/skills/task-decompose/package-catalog.md', 'packages/*/package.json'],
    run: 'node scripts/gen-package-catalog.mjs',
    check: 'node scripts/gen-package-catalog.mjs --check',
  },
  {
    name: 'lockfile',
    touches: ['pnpm-lock.yaml'],
    run: 'pnpm install --lockfile-only',
    check: null,
  },
]

const matches = (pattern, file) => {
  if (pattern.endsWith('/')) return file.startsWith(pattern)
  if (pattern.includes('*')) return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')}$`).test(file)
  return file === pattern
}

/** Generators whose inputs or outputs appear among `files`. */
export function generatorsFor(files) {
  return GENERATORS.filter((g) => files.some((f) => g.touches.some((p) => matches(p, f))))
}

/**
 * The paths the merge commit may hold (#3775): the conflicted files, plus what a generator keyed
 * off them rewrote (#2848). Any other edit is not part of resolving the merge — it stays unstaged
 * and the finish step commits it on top, as its own commit.
 */
export function resolutionPaths({ modified, conflicted, untracked = [] }) {
  const gens = generatorsFor(conflicted)
  const migDirs = [...new Set(conflicted.filter(isMigrationFile).map(migrationDirOf))]
  const inMigDir = (f) => migDirs.some((d) => f.startsWith(`${d}/`))
  const keep = [
    ...modified.filter((f) => conflicted.includes(f) || inMigDir(f) || gens.some((g) => g.touches.some((p) => matches(p, f)))),
    // a regenerated migration is a NEW file, which `git diff --name-only` does not list (#4320)
    ...untracked.filter(inMigDir),
  ]
  return [...new Set(keep)].sort()
}

// ── migrations (#4320): never hand-merged — take the base's, regenerate the branch's own ──

const MIG_SQL = /(^|\/)server\/db\/migrations\/(.+\/)?[^/]+\.sql$/
const MIG_META = /(^|\/)server\/db\/migrations\/(.+\/)?meta\/(_journal|[^/]+_snapshot)\.json$/

/** A drizzle migration file: `…/server/db/migrations/…/*.sql`, `…/meta/_journal.json` or `…/meta/*_snapshot.json`. */
export function isMigrationFile(path) {
  return MIG_SQL.test(path) || MIG_META.test(path)
}

/** The folder holding the `.sql` files (wrangler's `migrations_dir`), e.g. `apps/velo/server/db/migrations/sqlite`. */
export function migrationDirOf(path) {
  return path.replace(/\/meta\/[^/]+$/, '').replace(/\/[^/]+\.sql$/, '')
}

/** The app (pnpm package dir) that owns a migration folder, e.g. `apps/velo`. */
export function appDirOf(dir) {
  const i = dir.indexOf('server/db/migrations')
  return i <= 0 ? '.' : dir.slice(0, i - 1)
}

const pad4 = (n) => String(n).padStart(4, '0')
const journalOf = (dir) => `${dir}/meta/_journal.json`
const parseEntries = (text) => {
  const j = JSON.parse(text)
  if (!j || !Array.isArray(j.entries)) throw new Error('no entries array')
  return j.entries
}

const sqlOf = (dir, e) => `${dir}/${e.tag}.sql`
const snapOf = (dir, e) => `${dir}/meta/${pad4(e.idx)}_snapshot.json`
const journalRefusal = (jPath, why) => ({ file: jPath, reason: `hand-edited migration journal: ${jPath} — ${why}; take the base version and regenerate` })
const sameEntry = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** The resolved journal's entries, or a refusal when it does not parse. No journal on either side → []. */
function readJournal(j) {
  if (j.resolved === null) return j.base === null ? { entries: [] } : { entries: null, error: 'it was deleted' }
  try {
    return { entries: parseEntries(j.resolved) }
  } catch (e) {
    return { entries: null, error: `it does not parse (${e.message})` }
  }
}

function baseEntriesOf(j) {
  try { return j.base === null ? [] : parseEntries(j.base) } catch { return [] }
}

/** Rule 2: the base entries are an exact prefix; every entry beyond them has its .sql and snapshot. */
function journalRefusals(dir, jPath, j, entries, has) {
  if (j.resolved === j.base) return []
  const baseEntries = baseEntriesOf(j)
  const prefixOk = baseEntries.length <= entries.length && baseEntries.every((e, i) => sameEntry(e, entries[i]))
  if (!prefixOk) return [journalRefusal(jPath, 'the base entries were changed')]
  return entries.slice(baseEntries.length)
    .map((e) => [sqlOf(dir, e), snapOf(dir, e)].find((p) => !has.has(p)) && e)
    .filter(Boolean)
    .map((e) => journalRefusal(jPath, `entry ${e.tag} has no ${has.has(sqlOf(dir, e)) ? snapOf(dir, e) : sqlOf(dir, e)}`))
}

/** Rules 1 + 3: a conflicted or base-side migration file stays byte-for-byte the base's. */
function handEditRefusals(dir, jPath, files, conflicted) {
  const edited = ([path, f]) => (conflicted.includes(path) ? f.resolved !== f.base : f.base !== null && f.resolved !== f.base)
  return Object.entries(files)
    .filter(([path]) => path !== jPath && migrationDirOf(path) === dir && isMigrationFile(path))
    .filter(edited)
    .map(([path]) => ({ file: path, reason: `hand-edited migration file: ${path} — take the base version (git checkout --theirs) and regenerate` }))
}

/** Rule 4: wrangler applies every top-level .sql in the folder, journal or not. */
function looseRefusals(dir, entries, has) {
  const listed = new Set(entries.flatMap((e) => [sqlOf(dir, e), snapOf(dir, e)]))
  const counted = (rest) => /^[^/]+\.sql$/.test(rest) || /^meta\/[^/]+_snapshot\.json$/.test(rest)
  return [...has].sort()
    .filter((p) => p.startsWith(`${dir}/`) && counted(p.slice(dir.length + 1)) && !listed.has(p))
    .map((p) => ({ file: p, reason: `migration file not in the journal: ${p} — delete this branch's old migration (wrangler would still apply it) and regenerate` }))
}

function dirRefusals(dir, { conflicted, files, has }) {
  const jPath = journalOf(dir)
  const j = files[jPath] || { resolved: null, base: null }
  const { entries, error } = readJournal(j)
  const fileRefusals = handEditRefusals(dir, jPath, files, conflicted)
  if (!entries) return [journalRefusal(jPath, error), ...fileRefusals]
  return [...journalRefusals(dir, jPath, j, entries, has), ...fileRefusals, ...looseRefusals(dir, entries, has)]
}

/**
 * Was a migration resolved by hand? Pure — no I/O.
 *   conflicted: the conflicted paths.
 *   files: { [path]: { resolved, base } } (text, or null when absent) for every file in an affected folder
 *          that differs from the base side, PLUS each affected folder's `meta/_journal.json` (even when unchanged).
 *   present: every path in the affected folders after resolution.
 * Base journal entries are the base's history and are not re-checked (kassa's 0003 has no snapshot).
 */
export function checkMigrationResolution({ conflicted, files, present }) {
  const mig = conflicted.filter(isMigrationFile)
  if (!mig.length) return { applies: false }
  const dirs = [...new Set(mig.map(migrationDirOf))].sort()
  const apps = [...new Set(dirs.map(appDirOf))].sort()
  const has = new Set(present)
  const refused = dirs.flatMap((dir) => dirRefusals(dir, { conflicted, files, has }))
  return { applies: true, dirs, apps, refused }
}

export const MARKER = /^(<<<<<<<|=======|>>>>>>>)(\s|$)/m

/** Files (path → text) that still carry a conflict marker. */
export function withMarkers(contents) {
  return Object.keys(contents).filter((f) => MARKER.test(contents[f]))
}

/**
 * The verdict, from facts only: a choice file means pi found incompatible intents and stopped;
 * leftover markers mean the resolution is not one.
 */
export function verdict({ choiceText, markerFiles }) {
  if (choiceText && choiceText.trim()) return { status: 'choice' }
  if (markerFiles.length) return { status: 'failed', reason: `conflict markers remain in: ${markerFiles.join(', ')}` }
  return { status: 'resolved' }
}

export function buildPrompt({ base, files, choiceFile }) {
  const gens = GENERATORS.map((g) => `  - ${g.touches.join(', ')} → \`${g.run}\``).join('\n')
  const migApps = [...new Set(files.filter(isMigrationFile).map((f) => appDirOf(migrationDirOf(f))))].sort()
  const mig = migApps.length
    ? `\n5. MIGRATION FILES ARE NEVER HAND-MERGED (\`server/db/migrations/\`: \`*.sql\`, \`meta/_journal.json\`, \`meta/*_snapshot.json\`). Take the base version of every conflicted file there (\`git checkout --theirs -- <file>\`), delete this branch's own migration files after the base's last journal entry (its \`.sql\` and \`meta/NNNN_snapshot.json\`), then regenerate: ${migApps.map((a) => `\`pnpm --filter ./${a} db:generate\``).join(', ')}. Keep what it writes; never edit a snapshot or the journal yourself. If it fails, or writes nothing while this branch's schema differs from the base, write \`could not regenerate the migration: <reason>\` to ${choiceFile}.`
    : ''
  return `RESOLVE THE MERGE CONFLICT. This PR's branch is behind \`${base}\`, and merging \`${base}\` in left conflicts in:
${files.map((f) => `- ${f}`).join('\n')}

The merge is IN PROGRESS in the working tree (do not run git merge --abort, git commit or git add — the workflow commits it). Edit the files so the result keeps BOTH sides' intent:
1. Never drop one side to make the conflict go away. Read \`git diff\` / \`git log ${base} -3 -- <file>\` for what each side meant, and the ticket for this PR.
2. A generated file is regenerated, not hand-merged: resolve its INPUT, then run the generator.
${gens}
3. If both sides change the SAME logic in incompatible ways (same lines, different intent), do NOT pick one. Write the choice to ${choiceFile} instead: name side A's intent and side B's intent in one line each, then your recommendation. Leave the files as they are. Making no file change and writing no choice is a FAILED run.
4. When every conflict is resolved, no \`<<<<<<<\`, \`=======\` or \`>>>>>>>\` line may remain in any file.${mig}
Once every conflict (including pnpm-lock.yaml) is resolved, run \`${INSTALL_CMD}\`, then \`${BUILD_CMD}\` if the merge touched packages/ or pnpm-lock.yaml, then the touched tests (scripts/*.test.mjs via node --test, a touched package's tests) before you finish.`
}

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' })
const conflicted = () => sh('git', ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean)

function run(cmd) {
  // Output -> stderr: `verify` stdout is the file list the workflow captures, so a child's
  // test output on stdout would flood it (#2954: 126 "Argument list too long" on git commit).
  // Captured too, so a failure can name the failed tests (#4374).
  const r = spawnSync(cmd, { shell: true, stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const output = `${r.stdout || ''}${r.stderr || ''}`
  process.stderr.write(output)
  return { ok: r.status === 0, output }
}

const tryShow = (path) => { try { return execFileSync('git', ['show', `MERGE_HEAD:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null } }
const lines = (s) => s.split('\n').filter(Boolean)

/** One migration folder's base/resolved texts and the files present after resolution. */
function dirFacts(dir, conflictedFiles, untracked) {
  const tracked = lines(sh('git', ['ls-files', '--', dir]))
  const inBase = new Set(lines(sh('git', ['ls-tree', '-r', '--name-only', 'MERGE_HEAD', '--', dir])))
  const candidates = [...new Set([...tracked, ...inBase, ...untracked.filter((f) => f.startsWith(`${dir}/`)), journalOf(dir)])]
  const read = (p) => ({ p, resolved: existsSync(p) ? readFileSync(p, 'utf8') : null, base: inBase.has(p) ? tryShow(p) : null })
  const facts = candidates.map(read)
  const keep = (x) => x.resolved !== x.base || conflictedFiles.includes(x.p) || x.p === journalOf(dir)
  return {
    files: facts.filter(keep).map((x) => [x.p, { resolved: x.resolved, base: x.base }]),
    present: facts.filter((x) => x.resolved !== null).map((x) => x.p),
  }
}

/** The facts checkMigrationResolution judges, read from the merge in progress (base = MERGE_HEAD). */
function migrationFacts(conflictedFiles, untracked) {
  const per = [...new Set(conflictedFiles.filter(isMigrationFile).map(migrationDirOf))].map((d) => dirFacts(d, conflictedFiles, untracked))
  return { files: Object.fromEntries(per.flatMap((x) => x.files)), present: [...new Set(per.flatMap((x) => x.present))] }
}

/** Why a db:generate run did not succeed (its last output line), or null. */
function generateFailure(r) {
  const out = [r.stdout, r.stderr].filter(Boolean).join('')
  process.stderr.write(out)
  // drizzle-kit exits 0 even when it cannot load its config; only a recognised line counts (as migration-guard.mjs)
  const ok = r.status === 0 && /No schema changes|migration file/i.test(out)
  return ok ? null : lines(out).pop() ?? `exit ${r.status}`
}

/** Run the app's generator; it must succeed and write nothing (the resolved migrations already match the schema). */
function regenerateOk(appDir, dirs) {
  const status = () => sh('git', ['status', '--porcelain', '--untracked-files=all', '--', ...dirs])
  const before = status()
  const failed = generateFailure(spawnSync(`timeout 300 pnpm --filter ./${appDir} db:generate`, { shell: true, encoding: 'utf8' }))
  if (failed) return `could not regenerate the migration for ${appDir}: ${failed}`
  if (status() !== before) return `the migration in ${dirs.join(', ')} does not match the schema — run pnpm --filter ./${appDir} db:generate and keep what it writes`
  return null
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, a, b] = process.argv.slice(2)
  if (mode === 'prompt') {
    process.stdout.write(buildPrompt({ base: a, files: conflicted(), choiceFile: b }) + '\n')
  } else if (mode === 'verify') {
    const choiceText = a && existsSync(a) ? readFileSync(a, 'utf8') : ''
    const changed = sh('git', ['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean)
    const files = conflicted() // the files that clashed — generators/tests key off these, not the whole base diff
    const contents = Object.fromEntries([...new Set([...changed, ...files])].filter(existsSync).map((f) => [f, readFileSync(f, 'utf8')]))
    const v = verdict({ choiceText, markerFiles: withMarkers(contents) })
    if (v.status === 'choice') process.exit(3)
    if (v.status === 'failed') { console.error(`::error::${v.reason}`); process.exit(1) }
    const untracked = lines(sh('git', ['ls-files', '--others', '--exclude-standard']))
    // #4320: a snapshot or journal merged by hand no longer matches the schema — refuse it, naming the file.
    const mig = checkMigrationResolution({ conflicted: files, ...(files.some(isMigrationFile) ? migrationFacts(files, untracked) : { files: {}, present: [] }) })
    if (mig.applies && mig.refused.length) { for (const r of mig.refused) console.error(`::error::${r.reason}`); process.exit(1) }
    // Only the resolution (#3775): `git add -u` also staged any other tracked edit into the merge.
    // Mid-merge the auto-merged base files are already staged, so nothing of the base is dropped.
    const stage = resolutionPaths({ modified: lines(sh('git', ['diff', '--name-only'])), conflicted: files, untracked })
    if (stage.length) sh('git', ['add', '--', ...stage])
    if (mig.applies) {
      for (const app of mig.apps) {
        const err = regenerateOk(app, mig.dirs.filter((d) => appDirOf(d) === app))
        if (err) { console.error(`::error::${err}`); process.exit(1) }
      }
    }
    // Only the conflicted files: mid-merge the index holds the whole base diff, whose own whitespace is not ours to judge.
    try { if (files.length) sh('git', ['diff', '--cached', '--check', '--', ...files]) } catch (e) { console.error(`::error::git diff --check: ${e.stdout}`); process.exit(1) }
    for (const g of generatorsFor(files)) if (g.check && !run(g.check).ok) { console.error(`::error::${g.name} --check failed after resolution`); process.exit(1) }
    // #4374: the package builds came from PKG_DIST_REF's tree (main), not this merge — rebuild when that differs.
    const since = changedSinceBuild({ distRef: process.env.PKG_DIST_REF })
    if (since.note) console.error(since.note)
    const checks = runChecks({ changed: since.files, conflicted: files, run, log: (l) => console.error(l) })
    if (!checks.ok) { for (const e of checks.errors) console.error(`::error::${e}`); process.exit(1) }
    console.log(files.join('\n'))
  } else {
    console.error('usage: conflict-resolution.mjs prompt <base> <choice-file> | verify <choice-file>')
    process.exit(2)
  }
}
