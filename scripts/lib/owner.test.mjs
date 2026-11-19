import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_OWNER, isOwner } from './owner.mjs'

test('the default owner is pmcp', () => {
  assert.equal(DEFAULT_OWNER, 'pmcp')
})

test('pmcp is the owner, in any case', () => {
  assert.equal(isOwner({ userLogin: 'pmcp', userType: 'User' }), true)
  assert.equal(isOwner({ userLogin: 'PMCP', userType: 'User' }), true)
})

test('another login is not the owner', () => {
  assert.equal(isOwner({ userLogin: 'someone-else', userType: 'User' }), false)
})

test('a Bot with the owner login is not the owner', () => {
  assert.equal(isOwner({ userLogin: 'pmcp', userType: 'Bot' }), false)
})

test('no login is not the owner', () => {
  assert.equal(isOwner({ userType: 'User' }), false)
  assert.equal(isOwner(), false)
  assert.equal(isOwner({ userLogin: 42, userType: 'User' }), false)
})

test('a custom owner is honoured', () => {
  assert.equal(isOwner({ userLogin: 'alice', userType: 'User' }, 'Alice'), true)
  assert.equal(isOwner({ userLogin: 'pmcp', userType: 'User' }, 'alice'), false)
})

test("an empty owner ('' from an unset env var) falls back to pmcp", () => {
  assert.equal(isOwner({ userLogin: 'pmcp', userType: 'User' }, ''), true)
  assert.equal(isOwner({ userLogin: 'pmcp', userType: 'User' }, undefined), true)
  assert.equal(isOwner({ userLogin: 'someone-else', userType: 'User' }, ''), false)
})
