#!/usr/bin/env node
// design-handoff.mjs — carry design boards TO the pipeline as committed PNGs (#2430).
//
// The design for a UI epic often lives in a private canvas the runner cannot open, so
// someone re-describes it in prose. Commit the exported boards instead: pi's `read`
// tool can see images, and the reviewer gets a reference to compare the preview against.
//
// Usage:
//   node scripts/design-handoff.mjs <epic> <png…> [--post] [--branch <name>] [--repo owner/name]
//
// Copies each PNG to writeups/design/<epic>/, writes README.md naming them, refuses if git
// would ignore them, and prints
// the "Design" section (inline images). With --post it also upserts that section into
// the epic body (between <!-- design-handoff --> markers) via `gh`. Images link to the
// raw URL on --branch (default main) — pass the PR branch until the files are merged.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

export const START = '<!-- design-handoff:start -->'
export const END = '<!-- design-handoff:end -->'

/** Board file name → a readable title ("login-error.png" → "login error"). */
export function titleOf(file) {
  return basename(file, extname(file)).replace(/[-_]+/g, ' ').trim()
}

export function readmeFor(epic, files) {
  const lines = [
    `# Design handoff — epic #${epic}`,
    '',
    'Reference boards exported from the design canvas. Read these before building the UI;',
    'the reviewer compares the live preview against them.',
    '',
    ...files.map(f => `- \`${f}\` — ${titleOf(f)}`),
    ''
  ]
  return lines.join('\n')
}

export function sectionFor(epic, files, { repo, branch }) {
  const base = `https://raw.githubusercontent.com/${repo}/${branch}/writeups/design/${epic}`
  const body = files.flatMap(f => [`**${titleOf(f)}**`, '', `![${titleOf(f)}](${base}/${f})`, ''])
  return [START, '## 🎨 Design', '', ...body, END].join('\n')
}

/** Replace the marked block in an issue body, or append it when absent. */
export function upsertSection(issueBody, section) {
  const body = issueBody || ''
  const s = body.indexOf(START)
  const e = body.indexOf(END)
  if (s !== -1 && e > s) return body.slice(0, s) + section + body.slice(e + END.length)
  return `${body.replace(/\s+$/, '')}\n\n${section}\n`
}

/** True when git would ignore `path` (so `git add` silently adds nothing). */
function isIgnored(path) {
  try {
    execFileSync('git', ['check-ignore', '-q', path])
    return true
  } catch {
    return false
  }
}

function main(argv) {
  const args = argv.slice(2)
  const flags = { post: false, branch: 'main', repo: process.env.GITHUB_REPOSITORY || 'FriendlyInternet/nuxt-crouton' }
  const pos = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--post') flags.post = true
    else if (args[i] === '--branch') flags.branch = args[++i]
    else if (args[i] === '--repo') flags.repo = args[++i]
    else pos.push(args[i])
  }
  const [epic, ...pngs] = pos
  if (!/^\d+$/.test(epic || '') || pngs.length === 0) {
    console.error('usage: design-handoff.mjs <epic> <png…> [--post] [--branch <name>] [--repo owner/name]')
    process.exit(2)
  }
  for (const p of pngs) {
    if (extname(p).toLowerCase() !== '.png' || !existsSync(p)) {
      console.error(`not an existing .png: ${p}`)
      process.exit(2)
    }
  }
  const dir = resolve('writeups/design', epic)
  mkdirSync(dir, { recursive: true })
  const names = pngs.map(p => basename(p))
  pngs.forEach((p, i) => copyFileSync(p, join(dir, names[i])))
  writeFileSync(join(dir, 'README.md'), readmeFor(epic, names))
  // The copy "succeeds" even when git ignores the folder, and then nothing gets committed and
  // every image link is dead (the #1933 shape). Prove the boards are committable instead.
  const ignored = names.map(n => join('writeups/design', epic, n)).filter(isIgnored)
  if (ignored.length) {
    console.error(`git ignores ${ignored.join(', ')} — add an exception to .gitignore, or nothing will be committed`)
    process.exit(1)
  }
  const section = sectionFor(epic, names, flags)
  console.log(`copied ${names.length} board(s) to writeups/design/${epic}/ + README.md`)
  if (!flags.post) {
    console.log(section)
    return
  }
  const cur = execFileSync('gh', ['issue', 'view', epic, '--json', 'body', '-q', '.body'], { encoding: 'utf8' })
  execFileSync('gh', ['issue', 'edit', epic, '--body-file', '-'], { input: upsertSection(cur, section) })
  console.log(`updated Design section on #${epic}`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main(process.argv)
