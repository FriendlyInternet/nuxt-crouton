#!/usr/bin/env node
/**
 * workflow-gh-repo.mjs — flag jobs whose `gh` call can't tell which repo it is in (#3672).
 *
 * A job with no `actions/checkout` has no .git, so `gh workflow run` / `gh pr …` fail with
 * "not a git repository" unless GH_REPO is set (or --repo is given). That broke
 * loop-station-refresh.yml on every run. Pure text scan, no YAML dependency.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const INFER = /\bgh\s+(?:workflow|run|pr|issue|label|release|secret|variable|cache)\b|\bgh\s+api\b[^\n]*\{(?:owner|repo)\}/
const HAS_REPO = /(?:^|\s)(?:--repo|-R)[\s=]/

/** @returns {string[]} "file:job" entries that run a repo-inferring gh without a repo. */
export function findRepoless(text, file = 'workflow.yml') {
  const lines = text.split('\n')
  const jobsAt = lines.findIndex(l => /^jobs:\s*$/.test(l))
  if (jobsAt < 0) return []
  const top = lines.slice(0, jobsAt).join('\n')
  if (/\bGH_REPO\s*:/.test(top)) return []
  const flagged = []
  let name = null
  let body = []
  const flush = () => {
    if (!name) return
    const ghLines = body.filter(l => INFER.test(l) && !HAS_REPO.test(l) && !/^\s*#/.test(l))
    const joined = body.join('\n')
    if (ghLines.length && !/uses:\s*actions\/checkout/.test(joined) && !/\bGH_REPO\s*:/.test(joined)) {
      flagged.push(`${file}:${name}`)
    }
  }
  for (const l of lines.slice(jobsAt + 1)) {
    const m = l.match(/^ {2}([A-Za-z0-9_-]+):\s*$/)
    if (m) { flush(); name = m[1]; body = []; continue }
    body.push(l)
  }
  flush()
  return flagged
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows')
  const bad = readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).flatMap(f => findRepoless(readFileSync(join(dir, f), 'utf8'), f))
  if (bad.length) { console.error(`gh without a repo (set GH_REPO or checkout):\n  ${bad.join('\n  ')}`); process.exit(1) }
  console.log('ok')
}
