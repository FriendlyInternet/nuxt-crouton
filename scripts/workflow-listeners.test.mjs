// layer: harness
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listenersIn, parseAllow, check } from './workflow-listeners.mjs'

const wf = on => `name: x\n\non:\n${on}\n\njobs:\n  a:\n    runs-on: ubuntu-latest\n`

test('detects issue_comment', () => {
  assert.deepEqual(listenersIn(wf('  issue_comment:\n    types: [created]')), ['issue_comment'])
})

test('detects issues closed (inline and list types), ignores other actions', () => {
  assert.deepEqual(listenersIn(wf('  issues:\n    types: [labeled, closed]')), ['issues-closed'])
  assert.deepEqual(listenersIn(wf('  issues:\n    types:\n      - closed')), ['issues-closed'])
  assert.deepEqual(listenersIn(wf('  issues:\n    types: [labeled]')), [])
})

test('issues with no types fires on close too', () => {
  assert.deepEqual(listenersIn(wf('  issues:')), ['issues-closed'])
})

test('detects pull_request closed only', () => {
  assert.deepEqual(listenersIn(wf('  pull_request:\n    types: [closed]')), ['pr-closed'])
  assert.deepEqual(listenersIn(wf('  pull_request:\n    types: [opened, synchronize]')), [])
  assert.deepEqual(listenersIn(wf('  pull_request:\n    branches: [main]')), [])
})

test('does not confuse pull_request_target / pull_request_review_comment', () => {
  assert.deepEqual(listenersIn(wf('  pull_request_target:\n    types: [closed]')), [])
  assert.deepEqual(listenersIn(wf('  pull_request_review_comment:\n    types: [created]')), [])
})

test('inline on: forms', () => {
  assert.deepEqual(listenersIn('on: issue_comment\njobs: {}\n'), ['issue_comment'])
  assert.deepEqual(listenersIn('on: [push, issue_comment]\n'), ['issue_comment'])
})

test('parseAllow ignores comments and blanks', () => {
  assert.deepEqual([...parseAllow('# hi\n\nfoo.yml pr-closed # why\n')], ['foo.yml pr-closed'])
})

function fixture(files, allow = '') {
  const dir = mkdtempSync(join(tmpdir(), 'wfl-'))
  for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t)
  const allowFile = join(dir, 'allow')
  writeFileSync(allowFile, allow)
  return { dir, allowFile }
}

test('check: owner files pass, strangers are named, allowlist exempts', () => {
  const files = {
    'on-comment.yml': wf('  issue_comment:\n    types: [created]'),
    'on-pr-close.yml': wf('  pull_request:\n    types: [closed]'),
    'rogue.yml': wf('  issue_comment:\n    types: [created]'),
  }
  const bad = check(fixture(files))
  assert.equal(bad.length, 1)
  assert.match(bad[0], /^rogue\.yml .*issue_comment.*on-comment\.yml/)
  assert.deepEqual(check(fixture(files, 'rogue.yml issue_comment # legacy')), [])
})

test('check: the real repo is clean', () => {
  assert.deepEqual(check(), [])
})
