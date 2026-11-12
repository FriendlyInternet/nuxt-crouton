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
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { lastAssistantMessage, errorAnnotation, tailLines, buildRecord, newestSessionFile, finishCheckLine, readFinishCheckLine, appendFinishCheck } from './run-record.mjs'

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

test('#3762: the finish-check line says ran/rounds/last, or not run, and never throws', () => {
  assert.equal(finishCheckLine({ ran: true, rounds: 2, last: 'red' }), 'finish check: ran, 2 rounds, red')
  assert.equal(finishCheckLine({ ran: true, rounds: 1, last: 'green' }), 'finish check: ran, 1 round, green')
  assert.equal(finishCheckLine({ ran: true, rounds: 0, last: 'green' }), 'finish check: ran, 0 rounds, green')
  assert.equal(finishCheckLine({ ran: false, rounds: 0, last: 'not-run' }), 'finish check: not run')
  assert.equal(readFinishCheckLine(path.join(dir, 'missing.json')), 'finish check: not run')
  const bad = path.join(dir, 'bad.json')
  fs.writeFileSync(bad, '{not json')
  assert.equal(readFinishCheckLine(bad), 'finish check: not run')
  const script = fileURLToPath(new URL('./run-record.mjs', import.meta.url))
  const r = spawnSync(process.execPath, [script, 'finish-check-line', path.join(dir, 'missing.json')], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), 'finish check: not run')
})

// A fake `gh`: answers pr list / comment list / comment body, records every call.
function fakeGh({ pr = '42', ids = '7\n9', body = 'pi worker — run record\nok', failPatch = false } = {}) {
  const calls = []
  const gh = (args) => {
    calls.push(args)
    if (args[0] === 'pr') return pr
    if (args.includes('PATCH')) { if (failPatch) throw new Error('500'); return '' }
    if (args[1].endsWith('/comments')) return ids
    return body
  }
  return { gh, calls }
}

test('#3762: append-finish-check patches the NEWEST run-record comment of the open PR', () => {
  const out = path.join(dir, 'outcome.json')
  fs.writeFileSync(out, JSON.stringify({ ran: true, rounds: 2, last: 'green' }))
  const { gh, calls } = fakeGh()
  const r = appendFinishCheck({ outcomePath: out, branch: 'work-1', repo: 'o/r', gh })
  assert.equal(r.done, true)
  assert.deepEqual(calls[0].slice(0, 4), ['pr', 'list', '--head', 'work-1'])
  const patch = calls.at(-1)
  assert.ok(patch.includes('repos/o/r/issues/comments/9'))
  assert.equal(patch.at(-1), 'body=pi worker — run record\nok\n\n🔁 finish check: ran, 2 rounds, green')
})

test('#3762: append-finish-check is best effort — no PR, no comment, a failing API never throw or patch', () => {
  for (const [opts, why] of [[{ pr: '' }, 'no PR'], [{ ids: '' }, 'no run-record comment'], [{ body: '' }, 'empty comment body']]) {
    const { gh, calls } = fakeGh(opts)
    const r = appendFinishCheck({ outcomePath: '/nope', branch: 'b', repo: 'o/r', gh })
    assert.equal(r.done, false); assert.equal(r.why, why)
    assert.ok(!calls.some((c) => c.includes('PATCH')))
  }
  const { gh } = fakeGh({ failPatch: true })
  assert.equal(appendFinishCheck({ outcomePath: '/nope', branch: 'b', repo: 'o/r', gh }).why, 'patch failed')
  const throws = () => { throw new Error('boom') }
  assert.equal(appendFinishCheck({ outcomePath: '/nope', branch: 'b', repo: 'o/r', gh: throws }).why, 'no PR')
})

test('#3762: the CLI subcommand runs real `gh` from PATH and exits 0 either way', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-'))
  const log = path.join(bin, 'calls.log')
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const a = process.argv.slice(2); require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n')
if (a[0] === 'pr') console.log('5')
else if (a.includes('PATCH')) {}
else if (a[1].endsWith('/comments')) console.log('11')
else console.log('pi worker — run record')
`, { mode: 0o755 })
  const out = path.join(dir, 'cli-outcome.json')
  fs.writeFileSync(out, JSON.stringify({ ran: true, rounds: 1, last: 'red' }))
  const script = fileURLToPath(new URL('./run-record.mjs', import.meta.url))
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r' }
  const r = spawnSync(process.execPath, [script, 'append-finish-check', out, 'work-5'], { encoding: 'utf8', env })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /finish check: ran, 1 round, red/)
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(calls.at(-1).at(-1), 'body=pi worker — run record\n\n🔁 finish check: ran, 1 round, red')
  // No gh on PATH at all → still exit 0.
  const r2 = spawnSync(process.execPath, [script, 'append-finish-check', out, 'work-5'], { encoding: 'utf8', env: { ...env, PATH: '/nonexistent' } })
  assert.equal(r2.status, 0)
  assert.match(r2.stdout, /skipped \(no PR\)/)
})
