// Shape of the fix-bot's diagnose prompt (#3667) — the file the workflow hands the agent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const prompt = readFileSync(new URL('../../.claude/prompts/diagnose.md', import.meta.url), 'utf8')

test('names the five sections in order', () => {
  const at = ['Stopped at', 'Cause', 'Since when', 'Proof', 'Known before?'].map(s => {
    const i = prompt.indexOf(`#### ${s}`)
    assert.ok(i >= 0, `section ${s}`)
    return i
  })
  for (let k = 1; k < at.length; k++) assert.ok(at[k] > at[k - 1], 'sections in order')
})
test('carries the comment head and the marker', () => {
  assert.ok(prompt.includes('🩺 **Diagnosis**'))
  assert.ok(prompt.includes('diagnosis:v1'))
})
test('#3668: a round-2 redo section, the round in the marker, the review footer', () => {
  assert.ok(prompt.includes('## Redo (round 2)'))
  assert.match(prompt, /<!-- diagnosis:v1 sha=<head sha> check=<url-encoded check> round=<n> -->/)
  assert.match(prompt, /a second agent reviews this before any fix/)
  assert.ok(!prompt.includes('send it on with a **Worker:** comment'))
})
test('forbids commits and pushes', () => {
  assert.match(prompt, /Do NOT run `git commit` or `git push`/)
})
