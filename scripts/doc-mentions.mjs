#!/usr/bin/env node
/**
 * Report package notes (packages/*\/CLAUDE.md) that still mention a component, composable or config key
 * which existed on the base branch's api-reference pages but no longer exists in the code (#4053).
 *
 *   node scripts/doc-mentions.mjs --base <ref>
 *
 * Report only: exit 0 after a report (with or without hits), 2 on a bad base or a page that fails to build.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const PAGE_NAMES = ['components.md', 'composables.md', 'config-keys.md']

const COMPONENT = /^[A-Z][A-Za-z0-9]+$/
const COMPOSABLE = /^[a-z]+[A-Z][A-Za-z0-9]*$/

/** components.md: component headings + the bullets of the "Components without props" section. */
function componentNames(text) {
  const out = [...text.matchAll(/^## (\S+)$/gm)].map(m => m[1]).filter(n => COMPONENT.test(n))
  const bare = text.split(/^## Components without props$/m)[1]
  if (bare === undefined) return out
  const section = bare.split(/^## /m)[0]
  return out.concat([...section.matchAll(/^- `([^`]+)`/gm)].map(m => m[1]))
}

/** composables.md: camelCase headings. */
const composableHeadings = text => [...text.matchAll(/^## (\S+)$/gm)].map(m => m[1]).filter(n => COMPOSABLE.test(n))

/** config-keys.md: table keys containing a dot or a capital (a bare `style` is too common to match). */
const configKeys = text => [...text.matchAll(/^\| `([^`]+)` \|/gm)].map(m => m[1]).filter(k => /[.A-Z]/.test(k))

const READERS = { 'components.md': componentNames, 'composables.md': composableHeadings, 'config-keys.md': configKeys }

/** Names a set of pages `{ [page]: text }` documents: component/composable headings + dotted/capitalised config keys. */
export function namesOf(pages) {
  const names = new Set()
  for (const [page, read] of Object.entries(READERS)) for (const n of read(pages[page] ?? '')) names.add(n)
  return names
}

/** Base names that are neither on the pages now nor anywhere else in the code. */
export function goneNames(baseNames, nowNames, existing) {
  return [...baseNames].filter(n => !nowNames.has(n) && !existing.has(n)).sort()
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every line of `docs` ([{ file, text }]) mentioning a gone name as a whole name (fenced code included). */
export function mentions(gone, docs) {
  const res = [...gone].map(name => ({ name, re: new RegExp(`(?<![A-Za-z0-9_$-])${escape(name)}(?![A-Za-z0-9_$-])`) }))
  const hits = []
  for (const { file, text } of docs) {
    text.split('\n').forEach((line, i) => {
      for (const { name, re } of res) if (re.test(line)) hits.push({ file, line: i + 1, name, text: line })
    })
  }
  return hits
}

const normalise = s => s.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
const fail = (msg) => { console.error(`doc-mentions: ${msg}`); process.exit(2) }

const git = args => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })

/** The `--base` ref, verified to be a commit — exits 2 otherwise. */
function baseRef(argv) {
  const i = argv.indexOf('--base')
  const base = i >= 0 ? argv[i + 1] : undefined
  if (!base || base.startsWith('--')) fail('usage: node scripts/doc-mentions.mjs --base <ref>')
  if (git(['rev-parse', '--verify', `${base}^{commit}`]).status !== 0) fail(`base ${base} is not a commit`)
  return base
}

/** The three pages as committed at `base` — exits 2 if one is missing. */
function pagesAt(base) {
  const pages = {}
  for (const page of PAGE_NAMES) {
    const r = git(['show', `${base}:docs/content/8.api-reference/${page}`])
    if (r.status !== 0) fail(`docs/content/8.api-reference/${page} is missing at ${base}`)
    pages[page] = r.stdout
  }
  return pages
}

/** The three pages built from the code now, plus every name that still exists elsewhere — exits 2 on a throw. */
async function current() {
  try {
    const { PAGES, registeredComponentsOf } = await import('./gen-api-reference.mjs')
    const { composableNames } = await import('./check-doc-claims.mjs')
    const nowPages = Object.fromEntries(PAGE_NAMES.map(p => [p, normalise(PAGES[p]())]))
    return { nowPages, existing: new Set([...registeredComponentsOf(), ...composableNames()]) }
  } catch (e) {
    fail(`could not build the pages now: ${e?.message ?? e}`)
  }
}

async function main(argv) {
  const basePages = pagesAt(baseRef(argv))
  const { nowPages, existing } = await current()
  const gone = goneNames(namesOf(basePages), namesOf(nowPages), existing)
  const docs = readdirSync(join(ROOT, 'packages')).sort()
    .map(d => `packages/${d}/CLAUDE.md`)
    .filter(f => existsSync(join(ROOT, f)))
    .map(file => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }))
  console.log(gone.length ? `doc-mentions: gone: ${gone.join(', ')}` : 'doc-mentions: none')
  for (const h of mentions(gone, docs)) console.log(`${h.file}:${h.line}  \`${h.name}\` no longer exists in the code`)
  process.exit(0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2))
