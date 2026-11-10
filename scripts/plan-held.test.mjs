import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { currentOverrideDecision, overrideComment, parseCommentLines, BOT } from './plan-held.mjs'

const plan = (login = BOT) => ({ body: '<!-- pipeline-plan:v1 -->\nplan', user: { login } })
const dec = (login, reason = 'cosmetic') => ({ body: overrideComment({ reason, date: '2026-11-10', url: 'u' }), user: { login } })

test('bot decision after the newest plan is returned', () => {
  assert.equal(currentOverrideDecision([plan(), dec(BOT)]), 'cosmetic')
})
test('the same text from a person or another bot is ignored', () => {
  assert.equal(currentOverrideDecision([plan(), dec('pmcp')]), '')
  assert.equal(currentOverrideDecision([plan(), dec('github-actions[bot]')]), '')
})
test('a decision before a newer plan is ignored', () => {
  assert.equal(currentOverrideDecision([plan(), dec(BOT), plan()]), '')
})
test('a lookalike "Decision (owner override" comment from someone else is ignored', () => {
  assert.equal(currentOverrideDecision([plan(), { body: 'Decision (owner override): sneaky', user: { login: 'eve' } }]), '')
})
test('no comments → empty', () => assert.equal(currentOverrideDecision(), ''))

// The path the build really runs: `gh api --paginate … --jq '.[] | @json'` prints one comment per
// line, page after page. Feed that shape to the real CLI and expect the reason back unchanged.
const CLI = fileURLToPath(new URL('./plan-held.mjs', import.meta.url))
const runCli = (input) => spawnSync(process.execPath, [CLI, '--decision'], { input, encoding: 'utf8' })
const asGhLines = (pages) => pages.map((page) => page.map((c) => JSON.stringify(c)).join('\n') + '\n').join('')

test('CLI: two pages from the workflow command → the reason comes back unchanged', () => {
  const page1 = [plan(), { body: 'see [a] [b] and ] [ too', user: { login: 'pmcp' } }]
  const page2 = [dec(BOT, 'cosmetic [a] [b]')]
  const r = runCli(asGhLines([page1, page2]))
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'cosmetic [a] [b]\n')
})
test('CLI: a read that is not comment lines fails loudly, never a silent empty', () => {
  const r = runCli('[{"body": "truncated')
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
})
test('parseCommentLines keeps bodies byte-for-byte', () => {
  assert.deepEqual(parseCommentLines(asGhLines([[{ body: 'x [a] [b]' }], [{ body: 'y' }]])), [{ body: 'x [a] [b]' }, { body: 'y' }])
})

// Real entry points: the workflows must wire the rule, not just the helper exist.
const onComment = readFileSync(new URL('../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
const build = readFileSync(new URL('../.github/workflows/work-issue-pidev.yml', import.meta.url), 'utf8')
test('on-comment.yml has a job per new router choice and passes planHeld', () => {
  assert.match(onComment, /needs\.route\.outputs\.kind == 'approve-plan'/)
  assert.match(onComment, /needs\.route\.outputs\.kind == 'plan-needs-reason'/)
  assert.match(onComment, /planHeld/)
})
test('the build prompt reads the override only through plan-held.mjs', () => {
  assert.match(build, /--jq '\.\[\] \| @json' \| node scripts\/plan-held\.mjs --decision/)
})
