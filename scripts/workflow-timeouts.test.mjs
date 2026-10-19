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
const JOB_HEADER = /^  ([A-Za-z0-9_-]+):\s*$/
const TIMEOUT = /^    timeout-minutes:\s*(\d+)\s*$/
const REUSABLE = /^    uses:\s*\S/

/** The lines under the top-level `jobs:` key, up to the next top-level key. */
function jobsBlock(text) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => /^jobs:\s*$/.test(l))
  if (start < 0) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => /^\S/.test(l))
  return end < 0 ? rest : rest.slice(0, end)
}

/** @returns {Array<{file:string,id:string,timeout:number|null,reusable:boolean}>} */
function jobsIn(file, text) {
  const jobs = []
  let job = null
  for (const line of jobsBlock(text)) {
    const header = line.match(JOB_HEADER)
    if (header) {
      job = { file, id: header[1], timeout: null, reusable: false }
      jobs.push(job)
      continue
    }
    if (!job) continue
    const t = line.match(TIMEOUT)
    if (t) job.timeout = Number(t[1])
    if (REUSABLE.test(line)) job.reusable = true
  }
  return jobs
}

export function workflowJobs(dir = DIR) {
  return readdirSync(dir)
    .filter(f => /\.ya?ml$/.test(f))
    .flatMap(f => jobsIn(f, readFileSync(join(dir, f), 'utf8')))
}

test('every workflow job declares timeout-minutes (reusable-workflow calls exempt)', () => {
  const jobs = workflowJobs()
  assert.ok(jobs.length > 50, `parser found only ${jobs.length} jobs — layout assumption broken?`)
  const missing = jobs.filter(j => !j.reusable && j.timeout === null).map(j => `${j.file}:${j.id}`)
  assert.deepEqual(missing, [], `jobs without timeout-minutes: ${missing.join(', ')}`)
})

test('timeouts are sane: between 1 and 120 minutes', () => {
  const odd = workflowJobs()
    .filter(j => j.timeout !== null && (j.timeout < 1 || j.timeout > 120))
    .map(j => `${j.file}:${j.id}=${j.timeout}`)
  assert.deepEqual(odd, [], `implausible timeouts: ${odd.join(', ')}`)
})

test('parser: header, timeout, reusable and end-of-block are recognised', () => {
  const text = [
    'name: x', 'on: push', 'jobs:',
    '  a:', '    runs-on: ubuntu-latest', '    timeout-minutes: 7',
    '  b:', '    uses: ./.github/workflows/other.yml',
    '  c:', '    runs-on: ubuntu-latest',
    'permissions: {}', '  d:', '    timeout-minutes: 99',
  ].join('\n')
  assert.deepEqual(jobsIn('t.yml', text), [
    { file: 't.yml', id: 'a', timeout: 7, reusable: false },
    { file: 't.yml', id: 'b', timeout: null, reusable: true },
    { file: 't.yml', id: 'c', timeout: null, reusable: false },
  ])
})
