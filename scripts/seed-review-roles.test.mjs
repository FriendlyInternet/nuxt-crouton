import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { roleLogin, EXTRA_ROLES } from './seed-review-roles.mjs'

test('#3421 roleLogin matches the status app derivation (role in address + hash)', () => {
  const h = createHash('sha256').update('s:velo:main:member').digest('hex').slice(0, 24)
  assert.deepEqual(roleLogin('s', 'velo', 'main', 'member'), { email: 'review+velo-main-member@example.com', password: h })
  assert.deepEqual(EXTRA_ROLES, ['member', 'superadmin'])
})
