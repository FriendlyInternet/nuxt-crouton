import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, copyFileSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = 'writeups/reports/plan-review-ledger.jsonl'

test('append-only ledgers merge=union', async (t) => {
  await t.test('real repo declares merge=union for the ledger', () => {
    const out = execFileSync('git', ['check-attr', 'merge', '--', LEDGER], { cwd: root }).toString()
    assert.match(out, /merge: union/)
  })

  await t.test('two branches appending at EOF merge cleanly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'union-'))
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir }).toString()
    git('init', '-q', '-b', 'main')
    copyFileSync(join(root, '.gitattributes'), join(dir, '.gitattributes'))
    mkdirSync(join(dir, dirname(LEDGER)), { recursive: true })
    writeFileSync(join(dir, LEDGER), '{"a":0}\n')
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    for (const n of [1, 2]) {
      git('checkout', '-q', '-b', `b${n}`, 'main')
      writeFileSync(join(dir, LEDGER), `{"a":0}\n{"a":${n}}\n`)
      git('commit', '-q', '-am', `b${n}`)
    }
    git('merge', '-q', '--no-edit', 'b1')
    const text = readFileSync(join(dir, LEDGER), 'utf8')
    assert.ok(!text.includes('<<<<<<<'))
    const rows = text.trim().split('\n').map(l => JSON.parse(l).a)
    assert.deepEqual(rows.sort(), [0, 1, 2])
  })
})
