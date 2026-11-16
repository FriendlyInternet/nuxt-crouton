// #3331 — prompts must reach `pi` on stdin, never as one argv string (Linux caps a
// single argv entry at 128 KiB, so a long thread prompt dies with E2BIG).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SIZE = 3_000_000
const dir = mkdtempSync(join(tmpdir(), 'pi-stdin-'))
const prompt = join(dir, 'prompt.txt')
writeFileSync(prompt, 'a'.repeat(SIZE))
const stub = join(dir, 'pi')
writeFileSync(stub, `#!${process.execPath}
let n = 0
process.stdin.on('data', (c) => { n += c.length })
process.stdin.on('end', () => console.log('BYTES=' + n))
`)
chmodSync(stub, 0o755)
const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, P: prompt }

test('stdin redirect delivers a 3 MB prompt intact', () => {
  const r = spawnSync('bash', ['-c', 'pi --print < "$P"'], { env, encoding: 'utf8' })
  assert.match(r.stdout, new RegExp(`BYTES=${SIZE}`))
})

test('control: argv form fails with E2BIG', () => {
  const r = spawnSync('bash', ['-c', 'pi --print "$(cat "$P")"'], { env, encoding: 'utf8' })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /too long/i)
})

test('no workflow passes a prompt to pi via "$(cat ...)"', () => {
  const wf = '.github/workflows'
  const hits = []
  for (const f of readdirSync(wf).filter((x) => x.endsWith('.yml'))) {
    const lines = readFileSync(join(wf, f), 'utf8').split('\n')
    lines.forEach((l, i) => {
      if (/^\s*#/.test(l)) return
      const piLine = /\bpi --print\b/.test(l)
      const cont = i > 0 && /\\\s*$/.test(lines[i - 1]) && /pi --print/.test(lines[i - 1])
      if ((piLine || cont) && /"\$\(cat /.test(l)) hits.push(`${f}:${i + 1}`)
    })
  }
  assert.deepEqual(hits, [])
})
