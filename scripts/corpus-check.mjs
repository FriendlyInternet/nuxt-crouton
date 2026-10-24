#!/usr/bin/env node
/**
 * corpus-check.mjs — run a proposed gate's rule over every file it would judge, before
 * the gate merges (#1965).
 *
 *   node scripts/corpus-check.mjs --glob '<pattern>' --rule <rule.mjs> [--json] [--allow-empty]
 *
 * A gate's unit tests only prove it behaves as its author *imagined*. They cannot tell you
 * whether the rule is right about the repo it will judge — for that you have to run it over
 * the real corpus and look at what it refuses. Two cases from one session (#1751):
 *
 *   • #1957 — a `refTarget` validator compared the target against configured collection *names*.
 *     Eight unit tests green. `refTarget` names the generated DIRECTORY, which is the plural:
 *     apps/velo configures `location` and correctly says `refTarget: "locations"`. A corpus run
 *     found 4 shipping schemas the rule would have refused — and, incidentally, that the
 *     fall-through branch it was "fixing" was load-bearing for every plural target in the repo.
 *   • #1933 — the inverse: sign-off PNGs were silently gitignored, so every design hold posted a
 *     dead image link. Found by checking the artifact paths against the REAL `.gitignore`, not
 *     against a fixture's.
 *
 * ADVISORY, not enforced: a gate over a single generated file has no meaningful corpus, and
 * requiring a run there would be its own false positive. Reach for this when the rule judges a
 * class of files that already exist.
 *
 * ── The rule module ──────────────────────────────────────────────────────────────────────────
 * Any `.mjs` exporting `check` (or a default function):
 *
 *   export function check({ path, text, json }) {
 *     // falsy        → the rule accepts this file
 *     // string       → the rule REJECTS it, with this reason
 *     return json.fields?.some(f => f.refTarget === 'users') ? 'refTarget "users"' : null
 *   }
 *
 * A rejection is not automatically a bug — it is a claim you now have to defend file by file.
 * The exit code says "your rule refuses code that already ships", which is the question worth
 * answering before merge, so `--json` is there for when you want the data rather than a verdict.
 *
 * This script refuses to exit 0 on a zero-file glob (override: `--allow-empty`). A corpus run
 * that matched nothing and reported "clean" would be exactly the silent no-op #1966 is about.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Directories never worth scanning — build output and vendored code, not corpus. */
export const SKIP_DIRS = ['node_modules', '.git', '.nuxt', '.output', '.wrangler', 'dist']

/** Translate a glob (`**`, `*`, `?`) into an anchored RegExp over forward-slashed paths. */
export function globToRegExp(pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` spans any number of directories (including none); a bare `**` spans anything.
        if (pattern[i + 2] === '/') { out += '(?:[^/]*\\/)*'; i += 2 } else { out += '.*'; i += 1 }
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

/** Every file under `root` matching `pattern`, as repo-relative forward-slashed paths. */
export function findFiles(pattern, root = ROOT) {
  const re = globToRegExp(pattern)
  const found = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.includes(entry.name)) walk(full)
      } else {
        const rel = relative(root, full).replace(/\\/g, '/')
        if (re.test(rel)) found.push(rel)
      }
    }
  }
  walk(root)
  return found.sort()
}

/** Read one corpus file into the shape a rule receives. `json` is null when it doesn't parse. */
export function readCorpusFile(path, root = ROOT) {
  const text = readFileSync(join(root, path), 'utf8')
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON — the rule gets `text` */ }
  return { path, text, json }
}

/**
 * Run `rule` over `files`. Pure — the caller does the reading, so a test can pass literals.
 * @param {{files: Array<{path: string, text?: string, json?: any}>, rule: Function}} input
 * @returns {{scanned: number, rejected: Array<{path: string, reason: string}>, errored: Array<{path: string, reason: string}>}}
 */
export function runCorpus({ files = [], rule }) {
  if (typeof rule !== 'function') throw new TypeError('runCorpus: `rule` must be a function')
  const rejected = []
  const errored = []
  for (const file of files) {
    let verdict
    try {
      verdict = rule(file)
    } catch (err) {
      // A rule that THROWS on real input is a finding too — it would crash the gate in CI.
      errored.push({ path: file.path, reason: err?.message || String(err) })
      continue
    }
    if (verdict) rejected.push({ path: file.path, reason: typeof verdict === 'string' ? verdict : 'rejected' })
  }
  return { scanned: files.length, rejected, errored }
}

/** Human report. The scanned count is part of the verdict — "0 files, clean" is not clean. */
export function formatReport(result, { glob } = {}) {
  const lines = [`corpus-check: ${result.scanned} file(s) matched ${glob ? `\`${glob}\`` : 'the corpus'}`]
  if (result.scanned === 0) {
    lines.push('', '⚠️  MATCHED NOTHING — the glob is probably wrong. A rule that judged no files')
    lines.push('    has proved nothing. Pass --allow-empty if the empty corpus is genuinely expected.')
    return lines.join('\n')
  }
  for (const { path, reason } of result.errored) lines.push(`  💥 ${path} — rule threw: ${reason}`)
  for (const { path, reason } of result.rejected) lines.push(`  ✖ ${path} — ${reason}`)
  const bad = result.rejected.length + result.errored.length
  lines.push('')
  lines.push(
    bad === 0
      ? `✅ clean — the rule accepts all ${result.scanned} existing file(s).`
      : `❌ ${bad}/${result.scanned} existing file(s) refused. Each one is either a real finding or a\n   false positive in the rule — decide per file before this gate merges (#1965).`,
  )
  return lines.join('\n')
}

function parseArgs(argv) {
  const args = { glob: null, rule: null, json: false, allowEmpty: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--glob') args.glob = argv[++i]
    else if (a === '--rule') args.rule = argv[++i]
    else if (a === '--json') args.json = true
    else if (a === '--allow-empty') args.allowEmpty = true
  }
  return args
}

const USAGE = `Usage: node scripts/corpus-check.mjs --glob '<pattern>' --rule <rule.mjs> [--json] [--allow-empty]

  --glob         repo-relative glob of the files the gate would judge, e.g. 'apps/*/schemas/*.json'
  --rule         .mjs exporting check({ path, text, json }) → falsy (accept) | string (reject reason)
  --json         emit the result as JSON instead of a report
  --allow-empty  do not fail when the glob matches nothing (rarely what you want)`

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.glob || !args.rule) {
    console.error(USAGE)
    process.exit(2)
  }

  const mod = await import(pathToFileURL(resolve(args.rule)).href)
  const rule = mod.check || mod.default
  if (typeof rule !== 'function') {
    console.error(`corpus-check: ${args.rule} exports no \`check\` (or default) function.`)
    process.exit(2)
  }

  const paths = findFiles(args.glob)
  const result = runCorpus({ files: paths.map(p => readCorpusFile(p)), rule })

  if (args.json) console.log(JSON.stringify({ glob: args.glob, ...result }, null, 2))
  else console.log(formatReport(result, { glob: args.glob }))

  if (result.scanned === 0) process.exit(args.allowEmpty ? 0 : 1)
  process.exit(result.rejected.length + result.errored.length > 0 ? 1 : 0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => { console.error(err); process.exit(2) })
}
