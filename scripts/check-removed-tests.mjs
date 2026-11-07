#!/usr/bin/env node
// Removed-test check (#3314). Usage:
//   PR_BODY=... node scripts/check-removed-tests.mjs --base <sha> --head <sha> --branch <ref>
// `work-*` (pipeline) heads: exit 1 on any removal without a `Test removed: <title> — <why>`
// line in the PR body. Other heads: report only, exit 0.
import { execFileSync } from 'node:child_process'
import { parseArgs } from './lib/cli-args.mjs'
import { isPipelineBranch } from './lib/pipeline-branch.mjs'
import { TEST_FILE, removedTests, unexplained } from './lib/removed-tests.mjs'

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const tryShow = (rev, file) => {
  try { return git('show', `${rev}:${file}`) } catch { return undefined }
}
const testFilesAt = (rev) => git('ls-tree', '-r', '--name-only', rev).split('\n').filter((f) => TEST_FILE.test(f))

export function collect(baseTip, head) {
  // Compare against the merge-base, not the base branch tip: tests main gained after the
  // branch point are not removals by this PR.
  let base = baseTip
  try { base = git('merge-base', baseTip, head).trim() } catch { /* unrelated history: use tip */ }
  const snapshots = []
  const baseSnap = {}
  for (const f of testFilesAt(base)) baseSnap[f] = tryShow(base, f)
  snapshots.push(baseSnap)
  const commits = git('rev-list', '--reverse', '--first-parent', `${base}..${head}`).split('\n').filter(Boolean)
  for (const c of commits) {
    const snap = {}
    for (const f of git('diff-tree', '-r', '--no-commit-id', '--name-only', '-m', '--first-parent', c).split('\n')) {
      if (TEST_FILE.test(f)) {
        const src = tryShow(c, f)
        if (src !== undefined) snap[f] = src
      }
    }
    snapshots.push(snap)
  }
  const headSnap = {}
  for (const f of testFilesAt(head)) headSnap[f] = tryShow(head, f)
  return removedTests(snapshots, headSnap)
}

const args = parseArgs(process.argv.slice(2))
if (args.base && args.head) {
  const removed = collect(args.base, args.head)
  const pipeline = isPipelineBranch(args.branch)
  const missing = unexplained(removed, process.env.PR_BODY)
  if (!removed.length) console.log('removed-tests: no test case removed.')
  for (const r of removed) console.log(`removed: ${r.file} — ${r.title}`)
  if (pipeline && missing.length) {
    console.error(`\n${missing.length} removed test case(s) not explained. Add one PR-body line per removal:`)
    for (const r of missing) console.error(`  Test removed: ${r.title} — <why>`)
    process.exit(1)
  }
  if (removed.length && !pipeline) console.log('(not a pipeline branch — report only)')
}
