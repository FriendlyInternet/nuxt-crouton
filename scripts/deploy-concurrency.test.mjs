// Contract for deploy-apps.yml's concurrency group (#1699): a production/no-review_pr dispatch must
// never share a group with push-to-main (it evicts the queued staging deploy), while the PR keys
// from #1523/#2608 stay byte-identical. Dependency-free: regex out the YAML lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const text = readFileSync('.github/workflows/deploy-apps.yml', 'utf8')
const W = 'Deploy Apps (Cloudflare Workers)'

const groupLine = text.match(/^concurrency:\s*\n(?:\s*#.*\n)*\s+group: (.+)$/m)?.[1]
assert.ok(groupLine, 'concurrency.group line found')

// Translate every ${{ … }} to JS and evaluate with a fake context.
function key(github) {
  const js = groupLine.replace(/\$\{\{ (.*?) \}\}/g, (_, e) => `\${(${e})}`)
  const format = (s, ...a) => s.replace(/\{(\d+)\}/g, (_, i) => a[i])
  github = { event: { inputs: {}, pull_request: {} }, head_ref: '', ...github }
  return new Function('github', 'format', `return \`${js}\``)(github, format)
}
const ev = (event_name, o = {}) => ({
  event_name,
  workflow: W,
  ref: 'refs/heads/main',
  event: { inputs: o.inputs || {}, pull_request: o.pr ? { number: o.pr } : {} },
  head_ref: o.head_ref || '',
})
const dispatch = (inputs) => ev('workflow_dispatch', { inputs })

test('expression only uses github.*, format, literals and operators', () => {
  for (const [, e] of groupLine.matchAll(/\$\{\{ (.*?) \}\}/g)) {
    const stripped = e.replace(/'[^']*'/g, '').replace(/github\.[A-Za-z_.]+/g, '').replace(/format\(/g, '(')
    assert.match(stripped, /^[\s&|=!()0-9,]*$/, e)
  }
})

const push = () => ev('push')
test('push main vs production dispatch differ', () => {
  assert.notEqual(key(push()), key(dispatch({ environment: 'production', app: 'velo' })))
})
test('push main vs staging dispatch (no review_pr) differ', () => {
  assert.notEqual(key(push()), key(dispatch({ environment: 'staging', app: 'velo' })))
})
test('push main key unchanged', () => assert.equal(key(push()), `${W}-refs/heads/main`))
test('pull_request key unchanged', () => assert.equal(key(ev('pull_request', { pr: 5, head_ref: 'x' })), `${W}-5`))
test('staging dispatch with review_pr shares the PR group (#2608)', () => {
  assert.equal(key(dispatch({ environment: 'staging', app: 'velo', review_pr: '5' })), key(ev('pull_request', { pr: 5 })))
})
test('production dispatch with review_pr never shares the PR group', () => {
  assert.notEqual(key(dispatch({ environment: 'production', app: 'velo', review_pr: '5' })), key(ev('pull_request', { pr: 5 })))
})
test('production velo vs production kassa differ', () => {
  assert.notEqual(key(dispatch({ environment: 'production', app: 'velo' })), key(dispatch({ environment: 'production', app: 'kassa' })))
})
test('cancel-in-progress unchanged', () => {
  assert.match(text, /^  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m)
})
test('detect waits for staging before deploy-detect, production dispatch only', () => {
  const detect = text.slice(text.indexOf('\n  detect:'), text.indexOf('\n  deploy:'))
  const wait = detect.indexOf('node scripts/await-staging.mjs')
  assert.ok(wait > 0, 'wait step present')
  assert.ok(wait < detect.indexOf('node scripts/deploy-detect.mjs'), 'before deploy-detect')
  const step = detect.slice(detect.lastIndexOf('- name:', wait), wait)
  assert.match(step, /workflow_dispatch/)
  assert.match(step, /environment == 'production'/)
})
