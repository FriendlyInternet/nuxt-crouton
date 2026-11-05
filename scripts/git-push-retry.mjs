#!/usr/bin/env node
// `git push` that survives one GitHub server error (#3306, decision 6b). Self-contained: the finish
// step runs it from a $RUNNER_TEMP copy. A finished build is never lost to a 5xx and never pushed
// twice (before each retry it checks whether the remote already has the commit). Other failures
// (lease / non-fast-forward / auth) are returned untouched.
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function isServerPushError(output) {
  const t = String(output || '')
  if (/\((stale info|non-fast-forward|fetch first)\)/.test(t)) return false
  return /remote rejected[^\n]*\(Internal Server Error\)/i.test(t)
    || /The requested URL returned error: 5\d\d/.test(t)
    || /RPC failed; HTTP 5\d\d/.test(t)
    || /remote: Internal Server Error/i.test(t)
}

export async function pushWithRetry({ push, remoteHead, localHead, sleep, delays = [15, 45, 90], warn = () => {} }) {
  let r = await push()
  for (let i = 0; i < delays.length; i++) {
    if (r.code === 0 || !isServerPushError(r.output)) return r
    warn(`git push got a GitHub server error, retry ${i + 1}/${delays.length} in ${delays[i]}s`)
    await sleep(delays[i])
    try {
      if ((await remoteHead()) === (await localHead())) return { code: 0, output: `${r.output}\n(push landed despite the server error)` }
    } catch { /* can't tell → push again */ }
    r = await push()
  }
  return r
}

function sh(cmd, args) {
  const p = spawnSync(cmd, args, { encoding: 'utf8' })
  return { code: p.status ?? 1, output: `${p.stdout || ''}${p.stderr || ''}` }
}

async function main() {
  const args = process.argv.slice(2)
  // The target ref is the last `HEAD:<branch>` argument.
  const refspec = [...args].reverse().find((a) => a.startsWith('HEAD:')) || ''
  const branch = refspec.slice(5)
  const result = await pushWithRetry({
    push: async () => sh('git', ['push', ...args]),
    remoteHead: async () => sh('git', ['ls-remote', 'origin', `refs/heads/${branch}`]).output.split(/\s+/)[0],
    localHead: async () => sh('git', ['rev-parse', 'HEAD']).output.trim(),
    sleep: (s) => new Promise((r) => setTimeout(r, s * 1000)),
    warn: (m) => console.log(`::warning::${m}`),
  })
  process.stdout.write(result.output)
  process.exit(result.code)
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
