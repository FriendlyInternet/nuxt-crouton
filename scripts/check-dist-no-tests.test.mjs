import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { findTestArtifacts } from './check-dist-no-tests.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-dist-no-tests.mjs')

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'))
  for (const f of files) {
    const p = path.join(root, f)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, '')
  }
  return root
}

test('reports files under __tests__', () => {
  const r = fixture(['packages/a/dist/app/composables/__tests__/useX.test.d.ts'])
  assert.equal(findTestArtifacts(r).length, 1)
})

test('reports .test. and .spec. files outside __tests__', () => {
  const r = fixture(['packages/a/dist/foo.spec.mjs', 'packages/a/dist/bar.test.mjs'])
  assert.equal(findTestArtifacts(r).length, 2)
})

test('clean dist has no false matches', () => {
  const r = fixture(['packages/a/dist/index.mjs', 'packages/b/dist/utils/latest.d.ts', 'packages/b/dist/contest.mjs'])
  assert.deepEqual(findTestArtifacts(r), [])
  assert.equal(spawnSync('node', [CLI, '--root', r]).status, 0)
})

test('CLI fails when there is no dist at all', () => {
  const r = fixture(['packages/a/src/x.ts'])
  assert.notEqual(spawnSync('node', [CLI, '--root', r]).status, 0)
})

test('CLI fails on a test artifact', () => {
  const r = fixture(['packages/a/dist/x.test.mjs'])
  assert.equal(spawnSync('node', [CLI, '--root', r]).status, 1)
})

test('ignores node_modules inside dist', () => {
  const r = fixture(['packages/a/dist/node_modules/pkg/x.test.js', 'packages/a/dist/index.mjs'])
  assert.deepEqual(findTestArtifacts(r), [])
})
