// Runs docs/evals/run.mjs through its real entry point (a child process) with fetch replaced
// by a stand-in via --import. Node core only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = fileURLToPath(new URL('./run.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'evals-'))
const questions = join(dir, 'q.json')
writeFileSync(questions, JSON.stringify({ questions: [
  { id: 'good', kind: 'prose', question: 'Q-good', mustMention: ['crouton config'], mustNotMention: [] },
  { id: 'bad', kind: 'prose', question: 'Q-bad', mustMention: ['rollback'], mustNotMention: [] },
  { id: 'badcli', kind: 'prose', question: 'Q-badcli', mustMention: [], mustNotMention: [] }
] }))
const fake = join(dir, 'fake-fetch.mjs')
writeFileSync(fake, `
const answers = { 'Q-good': 'Run \`crouton config\`.', 'Q-bad': 'no idea', 'Q-badcli': 'Run \`crouton frobnicate\`.' }
globalThis.fetch = async (url, init) => {
  const q = JSON.parse(init.body).messages[0].content
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: answers[q] }] }), text: async () => '' }
}
`)

test('runner prints per-question pass/fail and writes the result file', () => {
  const outFile = join(dir, 'out.json')
  const r = spawnSync(process.execPath, ['--import', fake, run, '--questions', questions, '--out', outFile], {
    env: { ...process.env, ANTHROPIC_API_KEY: 'test-key' }, encoding: 'utf8'
  })
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stdout, /^PASS good$/m)
  assert.match(r.stdout, /^FAIL bad — missing: rollback$/m)
  assert.match(r.stdout, /^FAIL badcli — unknown CLI command: crouton frobnicate$/m)
  assert.match(r.stdout, /Score: 1\/3 \(33%\)/)
  const saved = JSON.parse(readFileSync(outFile, 'utf8'))
  assert.deepEqual(saved.results.map(x => [x.id, x.pass]), [['good', true], ['bad', false], ['badcli', false]])
})

test('runner exits 2 without ANTHROPIC_API_KEY', () => {
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY
  assert.equal(spawnSync(process.execPath, [run, '--questions', questions], { env, encoding: 'utf8' }).status, 2)
})
