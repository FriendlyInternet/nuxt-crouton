// Every GitHub Actions job must carry an explicit `timeout-minutes` (#2336).
//
// GitHub's default ceiling is 6 hours. A hung job holds its concurrency group that long, so
// later runs queue silently behind it (two eval-scoreboard runs sat 31 h in October 2026).
// Jobs that call a reusable workflow (`uses:` at job level) cannot carry a timeout — GitHub
// rejects it — so they are exempt; the called workflow's own jobs are checked instead.
//
// Deliberately dependency-free (no YAML parser): the scripts-tests CI job runs with no
// install. It relies on the repo's uniform 2-space workflow layout: `jobs:` at column 0,
// job ids at 2 spaces, job keys at 4 spaces.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = '.github/workflows'

/** @returns {Array<{file:string,id:string,timeout:number|null,reusable:boolean}>} */
export function workflowJobs(dir = DIR) {
  const out = []
  for (const file of readdirSync(dir).filter(f => /\.ya?ml$/.test(f))) {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n')
    let inJobs = false
    let job = null
    for (const line of lines) {
      if (/^jobs:\s*$/.test(line)) { inJobs = true; continue }
      if (!inJobs) continue
      if (/^\S/.test(line)) { inJobs = false; continue } // another top-level key ends `jobs:`
      const header = line.match(/^  ([A-Za-z0-9_-]+):\s*$/)
      if (header) { job = { file, id: header[1], timeout: null, reusable: false }; out.push(job); continue }
      if (!job) continue
      const t = line.match(/^    timeout-minutes:\s*(\d+)\s*$/)
      if (t) job.timeout = Number(t[1])
      if (/^    uses:\s*\S/.test(line)) job.reusable = true
    }
  }
  return out
}

test('every workflow job declares timeout-minutes (reusable-workflow calls exempt)', () => {
  const jobs = workflowJobs()
  assert.ok(jobs.length > 50, `parser found only ${jobs.length} jobs — layout assumption broken?`)
  const missing = jobs.filter(j => !j.reusable && j.timeout === null).map(j => `${j.file}:${j.id}`)
  assert.deepEqual(missing, [], `jobs without timeout-minutes: ${missing.join(', ')}`)
})

test('timeouts are sane: between 1 and 120 minutes', () => {
  const odd = workflowJobs().filter(j => j.timeout !== null && (j.timeout < 1 || j.timeout > 120)).map(j => `${j.file}:${j.id}=${j.timeout}`)
  assert.deepEqual(odd, [], `implausible timeouts: ${odd.join(', ')}`)
})
