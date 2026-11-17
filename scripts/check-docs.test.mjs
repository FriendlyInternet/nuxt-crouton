// node --test scripts/check-docs.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-docs.mjs')

function fixture({ withUndocumented = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'check-docs-'))
  mkdirSync(join(root, 'packages/a/server'), { recursive: true })
  writeFileSync(join(root, 'packages/a/package.json'), '{}')
  writeFileSync(join(root, 'packages/a/server/live.ts'), '')
  writeFileSync(join(root, 'packages/a/CLAUDE.md'), '# a\n\n`server/live.ts`\n`server/gone.ts`\n')
  if (withUndocumented) {
    mkdirSync(join(root, 'packages/b'), { recursive: true })
    writeFileSync(join(root, 'packages/b/package.json'), '{}')
  }
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  return root
}

function run(root) {
  return spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' })
}

test('T7 stale path is reported with a total and exits 0', () => {
  const root = fixture()
  try {
    const r = run(root)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /a · packages\/a\/CLAUDE\.md:4 · server\/gone\.ts/)
    assert.doesNotMatch(r.stdout, /server\/live\.ts/)
    assert.match(r.stdout, /📎 1 stale doc path\(s\)/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('T8 a package missing CLAUDE.md still exits 1 (and stale paths are still reported)', () => {
  const root = fixture({ withUndocumented: true })
  try {
    const r = run(root)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /MISSING CLAUDE\.md/)
    assert.match(r.stdout, /📎 1 stale doc path\(s\)/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
