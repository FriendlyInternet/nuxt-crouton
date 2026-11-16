// verify's per-package test step, end to end (#3900). Needs pnpm, so it lives in the *.deps-test.mjs set.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('./conflict-resolution.mjs', import.meta.url))

// A temp pnpm workspace mid-merge with a real conflict in packages/<p>/notes.md (never a package.json,
// so the package-catalog generator check does not fire), then resolved and verified.
function pkgConflict(pkgJson) {
  const p = pkgJson.name
  const dir = mkdtempSync(join(tmpdir(), 'verify-pkg-'))
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  const put = (f, t) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), t) }
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  put('package.json', JSON.stringify({ name: 'root', private: true }) + '\n')
  put('pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  put(`packages/${p}/package.json`, JSON.stringify(pkgJson) + '\n')
  put(`packages/${p}/notes.md`, 'one\n')
  git('add', '-A'); git('commit', '-qm', 'base0')
  git('checkout', '-qb', 'work'); put(`packages/${p}/notes.md`, 'one\nside\n'); git('commit', '-qam', 'side')
  git('checkout', '-q', 'main'); put(`packages/${p}/notes.md`, 'one\nbase\n'); git('commit', '-qam', 'base1')
  git('checkout', '-q', 'work')
  const m = git('merge', '--no-edit', 'main')
  assert.notEqual(m.status, 0, 'expected a real merge conflict')
  put(`packages/${p}/notes.md`, 'one\nbase\nside\n')
  return spawnSync('node', [CLI, 'verify', join(dir, 'none.md')], { cwd: dir, encoding: 'utf8' })
}

test("verify runs a conflicted package's test script with no extra arguments (#3900)", () => {
  const v = pkgConflict({ name: 'a', scripts: { test: `node -e "console.error('ARGS=' + JSON.stringify(process.argv.slice(1)))" --` } })
  assert.equal(v.status, 0, v.stderr)
  assert.match(v.stderr, /ARGS=\[\]/)
  assert.ok(!v.stderr.includes('ARGS=["--if-present"]'), v.stderr)
  assert.ok(!/ARGS=.*--if-present/.test(v.stderr), v.stderr)
})

test('verify passes a conflicted package with no test script', () => {
  const v = pkgConflict({ name: 'b' })
  assert.equal(v.status, 0, v.stderr)
})

test("verify still fails when a conflicted package's test fails", () => {
  const v = pkgConflict({ name: 'c', scripts: { test: 'node -e "process.exit(1)"' } })
  assert.notEqual(v.status, 0)
  assert.match(v.stderr, /c tests fail after resolution/)
})
