/**
 * #2464 contract — a red worker run explains itself via annotations/artifact.
 *
 *   node --test scripts/run-record.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { lastAssistantMessage, errorAnnotation, tailLines, buildRecord, newestSessionFile } from './run-record.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-record-'))
const rec = (role, content) => JSON.stringify({ type: 'message', message: { role, content } })
const session = path.join(dir, 's.jsonl')
fs.writeFileSync(session, [
  rec('user', [{ type: 'text', text: 'do it' }]),
  rec('assistant', [{ type: 'text', text: 'first answer' }]),
  'not json {{{',
  rec('assistant', [{ type: 'toolCall', name: 'bash' }]),
  rec('assistant', [{ type: 'text', text: 'Nothing left to do.' }, { type: 'text', text: 'Done.' }]),
  rec('toolResult', [{ type: 'text', text: 'ignored' }]),
  '',
].join('\n'))

test('last assistant text wins; tool-only and non-assistant records are skipped', () => {
  assert.equal(lastAssistantMessage(session), 'Nothing left to do.\nDone.')
})

test('long messages are truncated to the cap with an ellipsis', () => {
  const f = path.join(dir, 'long.jsonl')
  fs.writeFileSync(f, rec('assistant', 'x'.repeat(900)))
  const out = lastAssistantMessage(f, 500)
  assert.equal(out.length, 500)
  assert.ok(out.endsWith('…'))
})

test('missing file or no assistant message yields empty string, never throws', () => {
  assert.equal(lastAssistantMessage(path.join(dir, 'nope.jsonl')), '')
  const f = path.join(dir, 'user-only.jsonl')
  fs.writeFileSync(f, rec('user', 'hi'))
  assert.equal(lastAssistantMessage(f), '')
})

test('newestSessionFile finds the jsonl and tolerates a missing dir', () => {
  assert.ok(newestSessionFile(dir)?.endsWith('.jsonl'))
  assert.equal(newestSessionFile(path.join(dir, 'absent')), null)
})

test('annotation keeps the last 40 lines and escapes newlines (the #2444 shape)', () => {
  const log = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    + "\nfatal: 'origin/epic/9-x' is not a commit and a branch cannot be created from it 100%\n"
  const a = errorAnnotation('finish step', log)
  assert.ok(a.startsWith('::error title=finish step::'))
  assert.ok(!a.slice(1).includes('\n'))
  assert.ok(a.includes("fatal: 'origin/epic/9-x' is not a commit"))
  assert.ok(a.includes('100%25'))
  assert.ok(!a.includes('line 59%0A') && a.includes('line 61'))
  assert.equal(tailLines(log).length, 40)
})

test('empty output still annotates, and the record carries issue/step/exit/tail', () => {
  assert.match(errorAnnotation('t', ''), /no output captured/)
  const r = buildRecord({ issue: '7', step: 'finish', exit: '128', text: 'a\nb\n' })
  assert.deepEqual(r, { issue: 7, step: 'finish', exit: 128, tail: ['a', 'b'] })
})
