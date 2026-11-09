import { test } from 'node:test'
import assert from 'node:assert/strict'
import { earlierOwnerOk, lastVerdictAt } from './earlier-owner-ok.mjs'

const owner = 'pmcp'
const u = (body, at, login = owner, type = 'User') => ({ user: { login, type }, body, created_at: at })
const since = '2026-11-01T10:00:00Z'
const ok = (cs) => earlierOwnerOk({ comments: cs, owner, since })

test('owner ok after since → true', () => assert.equal(ok([u('ok', '2026-11-01T11:00:00Z')]), true))
test('owner not ok after since → false', () => assert.equal(ok([u('not ok: rename', '2026-11-01T11:00:00Z')]), false))
test('no owner comment → false', () => assert.equal(ok([]), false))
test('ok from another user → false', () => assert.equal(ok([u('ok', '2026-11-01T11:00:00Z', 'someone')]), false))
test('owner ok older than since → false', () => assert.equal(ok([u('ok', '2026-11-01T09:00:00Z')]), false))
test('owner not ok then ok → true', () => assert.equal(ok([u('not ok: x', '2026-11-01T11:00:00Z'), u('ok', '2026-11-01T12:00:00Z')]), true))
test('agent-headed comment from the owner account is ignored', () => {
  assert.equal(ok([u('> 🤖 **tool** · posted\n\nok', '2026-11-01T11:00:00Z')]), false)
})
test('login case differs → still matched', () => assert.equal(ok([u('ok', '2026-11-01T11:00:00Z', 'PMCP')]), true))
test('lastVerdictAt is the newest bot verdict comment', () => {
  const b = (sha, at) => u(`<!-- build-review-sha:${sha} -->\nx`, at, 'app[bot]', 'Bot')
  assert.equal(lastVerdictAt([b('aaa', '2026-11-01T10:00:00Z'), b('bbb', '2026-11-02T10:00:00Z'), u('ok', '2026-11-03T10:00:00Z')]), '2026-11-02T10:00:00Z')
  assert.equal(lastVerdictAt([]), null)
})
