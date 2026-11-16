#!/usr/bin/env node
// Removed-test check (#3314). Usage:
//   PR_BODY=... node scripts/check-removed-tests.mjs --base <sha> --head <sha> --branch <ref>
// `work-*` (pipeline) heads: exit 1 on any removal without a `Test removed: <title> — <why>`
// line in the PR body. Other heads: report only, exit 0.
// REMOVED_TESTS_MODE=report: pipeline heads also warn only (exit 0).
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
  const baseSnap = {}
  for (const f of testFilesAt(base)) baseSnap[f] = tryShow(base, f)
  // Only the PR's own commits: --no-merges drops "Merge main" commits, whose first-parent
  // diff is main's history, not this PR's work (#3538).
  const added = []
  const commits = git('rev-list', '--reverse', '--first-parent', '--no-merges', `${base}..${head}`).split('\n').filter(Boolean)
  for (const c of commits) {
    for (const f of git('diff-tree', '-r', '--no-commit-id', '--name-only', c).split('\n')) {
      if (!TEST_FILE.test(f)) continue
      const after = tryShow(c, f)
      if (after !== undefined) added.push({ file: f, before: tryShow(`${c}^`, f), after })
    }
  }
  const headSnap = {}
  for (const f of testFilesAt(head)) headSnap[f] = tryShow(head, f)
  return removedTests({ base: baseSnap, added }, headSnap)
}

const args = parseArgs(process.argv.slice(2))
if (args.base && args.head) {
  const removed = collect(args.base, args.head)
  const pipeline = isPipelineBranch(args.branch)
  const missing = unexplained(removed, process.env.PR_BODY)
  if (!removed.length) console.log('removed-tests: no test case removed.')
  for (const r of removed) console.log(`removed: ${r.file} — ${r.title}`)
  if (pipeline && missing.length) {
    // REMOVED_TESTS_MODE=report (set in ci.yml): warn, never fail, until proven (#3538).
    const report = process.env.REMOVED_TESTS_MODE === 'report'
    for (const r of missing) console.log(`::warning::removed test not explained: ${r.file} — ${r.title}`)
    console.error(`\n${missing.length} removed test case(s) not explained. Add one PR-body line per removal:`)
    for (const r of missing) console.error(`  Test removed: ${r.title} — <why>`)
    process.exit(report ? 0 : 1)
  }
  if (removed.length && !pipeline) console.log('(not a pipeline branch — report only)')
}
