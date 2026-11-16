#!/usr/bin/env node
// Revise-push truth (#3347). A refused push is not proof the PR changed, and a local base merge is
// not proof GitHub holds it. Two small decisions, kept pure so they are testable without a network:
//   pushFailure   — why did the push fail: did the remote head move ('moved'), or did GitHub refuse
//                   it while the head stayed put ('refused'), or can we not tell ('unknown')?
//   checkUpToDate — does GitHub's branch contain the exact base commit this run merged?
//
//   node revise-push.mjs classify <expectedHead> <branch> < push-output   → "<kind>\t<line>"
//   node revise-push.mjs verify <owner/repo> <targetSha> <baseName> <branch>   (exit 1 if behind)
import { execFileSync } from 'node:child_process'

/** The last `! [` line (continuation joined, whitespace collapsed); fallback: the last `error:` line. */
function reasonLine(output) {
  const lines = String(output || '').split('\n')
  let idx = -1
  lines.forEach((l, i) => { if (/^\s*!\s*\[/.test(l)) idx = i })
  if (idx >= 0) {
    let s = lines[idx]
    if (!/\)\s*$/.test(s) && lines[idx + 1] !== undefined) s += ' ' + lines[idx + 1]
    return s.replace(/\s+/g, ' ').replace(/ \)/g, ')').trim()
  }
  const errs = lines.filter(l => /^\s*(error|fatal):/.test(l))
  return (errs[errs.length - 1] || '').replace(/\s+/g, ' ').trim()
}

export function pushFailure({ output, remoteHead, expectedHead }) {
  const line = reasonLine(output)
  if (remoteHead) return { kind: remoteHead !== expectedHead ? 'moved' : 'refused', line }
  const moved = /stale info|fetch first|non-fast-forward/.test(String(output || ''))
  return { kind: moved ? 'moved' : 'unknown', line }
}

export function behindVerdict({ behindBy, aheadBy, target, base, branch }) {
  if (typeof behindBy !== 'number') return { ok: false, message: `could not read the compare result for ${branch} against ${String(target).slice(0, 7)}` }
  if (behindBy === 0) return { ok: true, message: `${branch} contains ${base}@${String(target).slice(0, 7)} on GitHub` }
  return { ok: false, message: `\`${branch}\` is still ${behindBy} commits behind \`${base}\`@\`${String(target).slice(0, 7)}\` on GitHub (${aheadBy ?? 0} ahead)` }
}

export async function checkUpToDate({ target, base, branch, compare, wait = 5000, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  let r = await compare(target, branch)
  if (!(r && r.behind_by === 0)) {
    await sleep(wait)
    r = await compare(target, branch)
  }
  return behindVerdict({ behindBy: r && r.behind_by, aheadBy: r && r.ahead_by, target, base, branch })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...a] = process.argv.slice(2)
  if (cmd === 'classify') {
    const [expectedHead, branch] = a
    let input = ''
    process.stdin.setEncoding('utf8')
    for await (const c of process.stdin) input += c
    let remoteHead = ''
    try {
      remoteHead = execFileSync('git', ['ls-remote', 'origin', `refs/heads/${branch}`], { encoding: 'utf8' }).trim().split(/\s+/)[0] || ''
    } catch {}
    const r = pushFailure({ output: input, remoteHead, expectedHead })
    console.log(`${r.kind}\t${r.line}`)
  } else if (cmd === 'verify') {
    const [repo, target, base, branch] = a
    const compare = async (t, b) => {
      try {
        return JSON.parse(execFileSync('gh', ['api', `repos/${repo}/compare/${t}...${b}`, '--jq', '{behind_by,ahead_by}'], { encoding: 'utf8' }))
      } catch { return null }
    }
    const r = await checkUpToDate({ target, base, branch, compare })
    console.log(r.message)
    process.exit(r.ok ? 0 : 1)
  } else {
    console.error('usage: revise-push.mjs classify|verify ...')
    process.exit(2)
  }
}
