import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OK, USAGE, FAILED, usage } from './cli-exit.mjs'

test('OK is 0', () => {
  assert.equal(OK, 0)
})

test('USAGE is 2', () => {
  assert.equal(USAGE, 2)
})

test('FAILED is 1', () => {
  assert.equal(FAILED, 1)
})

test('usage() prints the message to stderr and returns USAGE', () => {
  const original = console.error
  const calls = []
  console.error = (...args) => calls.push(args)
  try {
    const result = usage('bad args')
    assert.equal(result, USAGE)
    assert.deepEqual(calls, [['bad args']])
  } finally {
    console.error = original
  }
})

test('usage() does not call process.exit', () => {
  const original = process.exit
  let called = false
  process.exit = () => { called = true }
  try {
    usage('no exit please')
    assert.equal(called, false)
  } finally {
    process.exit = original
  }
})
