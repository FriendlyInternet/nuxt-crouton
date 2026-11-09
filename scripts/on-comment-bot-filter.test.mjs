import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wf = readFileSync(new URL('../.github/workflows/on-comment.yml', import.meta.url), 'utf8')

const jobBlock = (name) => {
  const m = wf.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:\\n|$)`))
  assert.ok(m, `job ${name} not found`)
  return m[1]
}
const jobIf = (name) => {
  const m = jobBlock(name).match(/\n    if: >-\n((?:      .*\n?)+)/)
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}

test('rl-start has the same job-level if as route', () => {
  const a = jobIf('rl-start')
  assert.notEqual(a, '')
  assert.equal(a, jobIf('route'))
})

test('the shared filter skips bots and runs for people', () => {
  const expr = jobIf('rl-start').replace(/==/g, '===').replace(/!=/g, '!==')
  const runs = (comment) => new Function('github', `return !!(${expr})`)({ event: { comment } })
  const f = (c) => runs({ ...c, performed_via_github_app: c.performed_via_github_app ?? null })
  assert.equal(f({ user: { type: 'Bot' } }), false)
  assert.equal(f({ user: { type: 'User' }, performed_via_github_app: { name: 'Harness' } }), false)
  assert.equal(f({ user: { type: 'User' } }), true)
  assert.equal(f({ user: { type: 'User' }, performed_via_github_app: { name: 'Claude' } }), true)
})

test('record-outcome still tolerates a skipped rl-start', () => {
  const b = jobBlock('record-outcome')
  assert.match(b, /needs: \[rl-start,/)
  assert.match(b, /\n    if: \$\{\{ always\(\)/)
})
