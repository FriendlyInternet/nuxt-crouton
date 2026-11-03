#!/usr/bin/env node
/**
 * Fail a pipeline PR that removes a test case without saying why (#3314).
 * Usage: node scripts/check-removed-tests.mjs --base <sha> --head <sha> --branch <ref>
 * PR body comes from env PR_BODY. `work-*` heads fail (exit 1); others only report.
 */
import { execFileSync } from 'node:child_process'
import { isPipelineBranch } from './lib/pipeline-branch.mjs'
import { removedTests, unexplained } from './lib/removed-tests.mjs'

const args = process.argv.slice(2)
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const base = arg('base'), head = arg('head'), branch = arg('branch') || ''
if (!base || !head) { console.error('usage: --base <sha> --head <sha> --branch <ref>'); process.exit(2) }

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
const show = (rev, path) => { try { return git('show', `${rev}:${path}`) } catch { return undefined } }
const isTest = (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p)

const commits = git('rev-list', '--reverse', '--first-parent', `${base}..${head}`).split('\n').filter(Boolean)
const files = new Set()
for (const c of commits) {
  for (const f of git('diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--first-parent', c).split('\n')) {
    if (f && isTest(f)) files.add(f)
  }
}
const snap = (rev) => {
  const s = {}
  for (const f of files) { const src = show(rev, f); if (src !== undefined) s[f] = src }
  return s
}
const snapshots = [snap(base), ...commits.map(snap)]
const removed = removedTests(snapshots, snap(head))
const bad = unexplained(removed, process.env.PR_BODY || '')

if (!removed.length) { console.log('removed-tests: no test cases removed.'); process.exit(0) }
console.log(`removed-tests: ${removed.length} removed, ${bad.length} unexplained.`)
for (const r of removed) console.log(`  ${bad.includes(r) ? 'UNEXPLAINED' : 'explained  '} ${r.file}: ${r.title}`)
if (bad.length && isPipelineBranch(branch)) {
  console.error('::error::Add one line per removed test to the PR body: `Test removed: <exact title> — <why>`')
  process.exit(1)
}
process.exit(0)
