#!/usr/bin/env node
// Worker-left merge guard (#3704). The pi worker may not run `git commit`, so a merge it starts is
// still in progress (.git/MERGE_HEAD or .git/SQUASH_MSG) when the finish step runs. The finish step
// then copies every changed file, re-creates the branch (which deletes MERGE_HEAD) and commits them
// with ONE parent — a flat copy of the merged branch (PR #3688: 267 files of `main` on an epic PR).
// By the time this runs the harness's own base merge is committed or already refused (#2914), so a
// merge in progress here was left by the worker: push nothing and say why on the PR.
//
//   node revise-merge-guard.mjs <base> <revStartSha> <prNumber|issue|''>
//
// Exit 0: no merge in progress — go on. Exit 3: refused (comment posted once per start head).
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

function gitIn(cwd) {
  return (...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Is a merge (or squash) the worker started still in progress? */
export function detectWorkerMerge({ cwd = process.cwd() } = {}) {
  const git = gitIn(cwd)
  let mergeHead = ''
  try { mergeHead = git('rev-parse', '-q', '--verify', 'MERGE_HEAD') } catch {}
  let squash = false
  if (!mergeHead) {
    try { squash = existsSync(join(resolve(cwd, git('rev-parse', '--git-dir')), 'SQUASH_MSG')) } catch {}
  }
  if (!mergeHead && !squash) return { refuse: false }
  let files = 0
  try { files = git('status', '--porcelain', '-uall').split('\n').filter(Boolean).length } catch {}
  if (squash) return { refuse: true, kind: 'squash', ref: 'a squash merge', files }
  let ref = ''
  try { ref = git('name-rev', '--name-only', '--exclude=tags/*', 'MERGE_HEAD') } catch {}
  ref = ref.replace(/^remotes\/origin\//, '').replace(/^origin\//, '')
  if (!ref || ref === 'undefined') ref = mergeHead.slice(0, 7)
  return { refuse: true, kind: 'merge', ref, files }
}

/** The plain-words PR comment for a refused round. */
export function refusalBody({ ref, files, base, headShort, marker, kind = 'merge' }) {
  const lines = [
    marker,
    '> 🤖 **pi.dev harness** · agent pipeline (CI) · _revision (#3704)_',
    '',
    `⚠️ **Not pushed — the worker merged \`${ref}\` into this branch, and that would have been saved as one ordinary commit of ${files} files.**`,
    '',
  ]
  if (kind === 'squash' || ref === base) {
    lines.push(`This PR is unchanged at \`${headShort}\`. Nothing was overwritten — comment again and I will redo it without the merge.`)
  } else {
    lines.push(`This PR is unchanged at \`${headShort}\`. This PR's base is \`${base}\`; to bring in \`${ref}\`, update \`${base}\` itself (the PR then catches up from its base automatically). Nothing was overwritten.`)
  }
  return lines.join('\n')
}

/** Has this refusal (same start head) already been explained? */
export function alreadyPosted(comments, marker) {
  return (comments || []).some((c) => String(c).includes(marker))
}

export function markerFor(revStart) { return `<!-- revise-merge-refused:${revStart} -->` }

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base = '', revStart = '', target = ''] = process.argv.slice(2)
  const d = detectWorkerMerge()
  if (!d.refuse) process.exit(0)
  console.log(`::warning::worker left a merge of ${d.ref} in progress (${d.files} files) — pushing nothing (#3704)`)
  if (target) {
    const marker = markerFor(revStart)
    const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      let existing = ''
      try { existing = gh('api', `repos/${process.env.GITHUB_REPOSITORY}/issues/${target}/comments`, '--paginate', '--jq', '.[].body') } catch {}
      if (!alreadyPosted([existing], marker)) {
        const body = refusalBody({ ...d, base, headShort: revStart.slice(0, 7), marker })
        try { gh('pr', 'comment', target, '--body', body) } catch { gh('issue', 'comment', target, '--body', body) }
      }
    } catch (e) {
      console.log(`::warning::could not post the merge-refusal comment: ${String(e.stderr || e.message).trim()} (#3704)`)
    }
  }
  process.exit(3)
}
