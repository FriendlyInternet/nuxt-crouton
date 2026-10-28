import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideAction, parseModelOutput, readAs, ACTIONS } from './comment-interpret.mjs'

const held = { labels: ['status:blocked'] }
const plain = { labels: [] }
const pr = { headRef: 'work-7' }
const j = (o) => JSON.stringify(o)

test('case 3: unknown action, malformed output, empty → ask', () => {
  assert.equal(decideAction({ modelOutput: j({ action: 'explode', reason: 'x' }), issue: plain }).action, 'ask')
  assert.equal(decideAction({ modelOutput: 'not json', issue: plain }).action, 'ask')
  assert.equal(decideAction({ modelOutput: '', issue: plain }).action, 'ask')
  assert.equal(decideAction({ modelOutput: undefined, issue: plain }).action, 'ask')
})

test('case 3: JSON wrapped in prose is still read', () => {
  assert.deepEqual(parseModelOutput('Sure: {"action":"ignore"} done'), { action: 'ignore' })
  assert.equal(decideAction({ modelOutput: 'Sure: {"action":"ignore","reason":"thanks"}', issue: plain }).action, 'ignore')
})

test('case 4: each allowed action passes when the thread fits', () => {
  const ok = (action, issue, p) => decideAction({ modelOutput: j({ action, reason: 'r' }), issue, pr: p }).action
  assert.equal(ok('revise', plain, pr), 'revise')
  assert.equal(ok('start', plain), 'start')
  assert.equal(ok('review', plain), 'review')
  assert.equal(ok('answer', plain), 'answer')
  assert.equal(ok('ask', plain), 'ask')
  assert.equal(ok('ignore', plain), 'ignore')
  assert.equal(ACTIONS.length, 8)
})

test('case 4: an action that does not fit the thread becomes ask', () => {
  const ok = (action, issue, p) => decideAction({ modelOutput: j({ action, reason: 'r' }), issue, pr: p }).action
  assert.equal(ok('revise', plain, { headRef: 'feature/x' }), 'ask')
  assert.equal(ok('revise', plain), 'ask')
  assert.equal(ok('replan', plain), 'ask')
  assert.equal(ok('start', { labels: ['delegate'] }), 'ask')
  assert.equal(ok('start', plain, pr), 'ask')
})

test('case 5: merge / close / delete / deploy / teardown are only ever confirm', () => {
  for (const a of ['merge', 'close', 'delete', 'deploy', 'teardown', 'Merge', 'ship', 'tear-down']) {
    const d = decideAction({ modelOutput: j({ action: a, reason: 'wants it', confirmText: 'merge this PR' }), issue: plain, pr })
    assert.equal(d.action, 'confirm', a)
    assert.equal(d.confirmText, 'merge this PR')
  }
  const d = decideAction({ modelOutput: j({ action: 'confirm', reason: 'close the epic' }), issue: plain })
  assert.equal(d.action, 'confirm')
  assert.equal(d.confirmText, 'close the epic')
})

test('case 6: the reply opener never carries an @mention', () => {
  const t = readAs({ action: 'confirm', confirmText: 'ping @pmcp' })
  assert.match(t, /^I read this as: /)
  assert.ok(!/@(?=pmcp)/.test(t))
})

test('case 7: replan / start on a held ticket only ever confirm — never release the hold', () => {
  for (const a of ['replan', 'start']) {
    const d = decideAction({ modelOutput: j({ action: a, reason: 'fresh pass' }), issue: held })
    assert.equal(d.action, 'confirm', a)
    assert.match(d.confirmText, /pipeline/)
  }
  assert.equal(decideAction({ modelOutput: j({ action: 'replan', reason: 'r' }), issue: plain }).action, 'ask')
})

test('case 6b: model-written reply text is defanged too', async () => {
  const { noMention } = await import('./comment-interpret.mjs')
  assert.ok(!/@(?=pmcp)/.test(noMention('ask @pmcp and @team')))
})
