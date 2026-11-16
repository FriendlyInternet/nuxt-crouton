#!/usr/bin/env node
/**
 * #3696 — check out a PR head for the build reviewer as DATA, but keep the reviewer's own pi
 * settings (`.pi/`: settings.json + extensions) from the trusted default branch.
 *
 * Why: build-review.yml starts `pi --approve` in the working tree, so pi reads the project's
 * `.pi/settings.json` and loads `.pi/extensions/*.ts`. With the PR head checked out, an old branch
 * (cut before claude-bridge landed in `.pi/settings.json`) made pi fail with `Unknown provider
 * "claude-bridge"`, and a PR's own extensions ran inside the reviewer.
 *
 * Steps, in order:
 *   1. git fetch --no-tags origin <base> <sha>   (fallback: pull/<pr>/head if the sha fetch fails, #3796)
 *   2. git checkout --detach <sha>
 *   3. write `git diff -C --find-copies-harder --no-color origin/<base>...<sha>` to <diff> — BEFORE
 *      touching `.pi`, so the head's own `.pi` changes stay visible as data
 *   4. delete every tracked `.pi` file at the head, then restore `.pi` from <trusted> into the
 *      WORKTREE only (the index stays the head's, so `git show HEAD:.pi/…` still shows the PR).
 *      The untracked `.pi/npm/` (installed by setup-pi) is left alone.
 *      #3874 — then also restore, from <trusted> and WORKTREE only, every file outside `.pi/` that
 *      the trusted extensions import (their relative import closure, e.g. scripts/lib/*.mjs).
 *      Without it an old head made the trusted extensions fail to load (a missing module, or an
 *      older copy without the named exports). The index stays the head's, so `git show HEAD:<file>`
 *      and diff.patch still show the PR's own version of those files as data.
 *
 *   node scripts/review-checkout.mjs --base <branch> --pr <n> --sha <sha> --trusted <ref> --diff <file>
 *
 * This file is loaded from the default branch's checkout BEFORE step 2; ESM resolves at load
 * time, so the head's copy of scripts/ never runs.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultGit = (args, opts) => execFileSync('git', args, { maxBuffer: 1024 * 1024 * 512, ...opts })

const CODE_FILE = /\.(ts|mjs|js)$/
// import … from '…' · export … from '…' · import '…' · import('…') — relative specifiers only.
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g

/** Relative specifiers a module source imports or re-exports. */
export function relativeSpecifiers(source) {
  return [...source.matchAll(IMPORT_RE)].map((m) => m[2])
}

/**
 * #3874 — every file OUTSIDE `.pi/` that the `.pi/extensions/*` at <trusted> import, transitively,
 * read from git at <trusted> (not the worktree). A specifier that does not exist at <trusted>
 * throws: a broken trusted tree must fail loudly.
 */
export function trustedImportClosure({ run, trusted }) {
  const exists = new Set(run(['ls-tree', '-r', '--name-only', trusted]).toString('utf8').split('\n').filter(Boolean))
  const queue = [...exists].filter((f) => f.startsWith('.pi/extensions/') && CODE_FILE.test(f))
  const seen = new Set(queue)
  while (queue.length) {
    const file = queue.shift()
    const source = run(['show', `${trusted}:${file}`]).toString('utf8')
    for (const spec of relativeSpecifiers(source)) {
      const target = posix.normalize(posix.join(posix.dirname(file), spec))
      if (!exists.has(target)) throw new Error(`review-checkout: ${file} imports ${spec}, but ${target} does not exist at ${trusted}`)
      if (seen.has(target)) continue
      seen.add(target)
      if (CODE_FILE.test(target)) queue.push(target)
    }
  }
  return [...seen].filter((f) => !f.startsWith('.pi/')).sort()
}

export function checkoutForReview({ cwd = process.cwd(), base, pr, sha, trusted, diffFile, git = defaultGit, log = console.log }) {
  for (const [k, v] of Object.entries({ base, pr, sha, trusted, diffFile })) {
    if (!v) throw new Error(`review-checkout: missing ${k}`)
  }
  const run = (args) => git(args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] })

  // #3796 — GitHub does not always create refs/pull/<n>/head, so fetch the head by its sha first.
  try {
    run(['fetch', '--no-tags', 'origin', base, sha])
  } catch {
    log(`review-checkout: fetch by sha ${sha} failed — falling back to pull/${pr}/head`)
    run(['fetch', '--no-tags', 'origin', base, `pull/${pr}/head`])
  }
  run(['checkout', '--detach', sha])
  const head = run(['rev-parse', 'HEAD']).toString('utf8').trim()
  if (head !== sha) throw new Error(`review-checkout: HEAD is ${head}, expected ${sha}`)
  const diff = run(['diff', '-C', '--find-copies-harder', '--no-color', `origin/${base}...${sha}`])
  writeFileSync(diffFile, diff)

  let settings
  try {
    settings = run(['show', `${trusted}:.pi/settings.json`]).toString('utf8')
  } catch {
    throw new Error(`trusted ref ${trusted} has no .pi/settings.json — reviewer settings cannot be pinned`)
  }

  const headPi = run(['ls-files', '-z', '--', '.pi']).toString('utf8').split('\0').filter(Boolean)
  for (const f of headPi) rmSync(join(cwd, f), { force: true })
  run(['restore', `--source=${trusted}`, '--worktree', '--', '.pi'])

  const extDeps = trustedImportClosure({ run, trusted })
  if (extDeps.length) run(['restore', `--source=${trusted}`, '--worktree', '--', ...extDeps])

  let provider = '?'
  let packages = 0
  try {
    const j = JSON.parse(settings)
    provider = j.defaultProvider ?? '?'
    packages = Array.isArray(j.packages) ? j.packages.length : 0
  } catch { /* the log line is informational; pi reports a broken settings file itself */ }
  log(`reviewer settings: .pi/ from ${trusted} (defaultProvider ${provider}, ${packages} packages) — the PR head's .pi/ is in diff.patch and git show HEAD:.pi/…`)
  log(`reviewer extension deps: ${extDeps.length} files from ${trusted} (${extDeps.join(', ') || 'none'})`)
  log(`diff.patch: ${diff.length} bytes`)
  return { diffBytes: diff.length, provider, packages, extDeps }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(base|pr|sha|trusted|diff)$/.exec(argv[i])
    if (m) out[m[1]] = argv[++i]
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2))
  try {
    checkoutForReview({ base: a.base, pr: a.pr, sha: a.sha, trusted: a.trusted, diffFile: a.diff })
  } catch (e) {
    console.error(`::error::${e.message}`)
    process.exit(1)
  }
}
