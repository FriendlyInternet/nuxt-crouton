import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wf = readFileSync(new URL('../.github/workflows/automerge-epic-subpr.yml', import.meta.url), 'utf8')

test('pull_request trigger includes labeled', () => {
  assert.match(wf, /pull_request:\s*\n(?:\s*#.*\n)*\s*types: \[[^\]]*\blabeled\b/)
})

test('job `if` lets labeled through only for build:approved', () => {
  assert.match(wf, /github\.event\.action != 'labeled' \|\| github\.event\.label\.name == 'build:approved'/)
})
