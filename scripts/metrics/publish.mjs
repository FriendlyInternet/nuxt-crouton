#!/usr/bin/env node
// publish.mjs — commit `metrics/` in a pipeline-data checkout and push it (#3679).
// Rebases and retries on a non-fast-forward: record-run only writes records/ and plan-ledger/,
// so the rebase cannot conflict. Prints `pushed <sha>` or `no change`.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const README_LINE = 'metrics/: hourly run/job history + latest.json (#3679, scripts/metrics/README.md).'
const BOT = ['-c', 'user.name=nuxt-harness[bot]', '-c', 'user.email=nuxt-harness[bot]@users.noreply.github.com']

const defaultRun = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' })

export function publish({ dir, message, run = defaultRun, tries = 3 }) {
  const readme = join(dir, 'README.md')
  if (existsSync(readme) && !readFileSync(readme, 'utf8').includes('metrics/')) appendFileSync(readme, `\n${README_LINE}\n`)
  run(['add', 'metrics', ...(existsSync(readme) ? ['README.md'] : [])], dir)
  if (!run(['status', '--porcelain', '--', 'metrics', 'README.md'], dir).trim()) return { pushed: false, sha: null }
  run([...BOT, 'commit', '-m', message], dir)
  for (let n = 1; ; n++) {
    try {
      run(['push', 'origin', 'HEAD:pipeline-data'], dir)
      return { pushed: true, sha: run(['rev-parse', 'HEAD'], dir).trim() }
    } catch (e) {
      if (n >= tries) throw e
      run([...BOT, 'pull', '--rebase', 'origin', 'pipeline-data'], dir)
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const a = (n) => process.argv[process.argv.indexOf(`--${n}`) + 1]
  const out = publish({ dir: a('data'), message: a('message') })
  console.log(out.pushed ? `pushed ${out.sha}` : 'no change')
}
