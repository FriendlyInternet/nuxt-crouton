/** node --test scripts/workflow-gh-repo.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findRepoless } from './workflow-gh-repo.mjs'

const wf = (steps, extra = '') => `name: x\non: push\n${extra}jobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`
const run = cmd => `      - run: ${cmd}\n`

test('flagged: gh workflow run, no checkout, no GH_REPO', () => {
  assert.deepEqual(findRepoless(wf(run('gh workflow run a.yml')), 'x.yml'), ['x.yml:j'])
})
test('clean: step env GH_REPO', () => {
  assert.deepEqual(findRepoless(wf(`      - env:\n          GH_REPO: \${{ github.repository }}\n        run: gh workflow run a.yml\n`)), [])
})
test('clean: job env GH_REPO', () => {
  const t = `on: push\njobs:\n  j:\n    env:\n      GH_REPO: a/b\n    steps:\n${run('gh pr list')}`
  assert.deepEqual(findRepoless(t), [])
})
test('clean: workflow-level env GH_REPO', () => {
  assert.deepEqual(findRepoless(wf(run('gh pr list'), 'env:\n  GH_REPO: a/b\n')), [])
})
test('clean: --repo / -R on the line', () => {
  assert.deepEqual(findRepoless(wf(run('gh pr list --repo o/x'))), [])
  assert.deepEqual(findRepoless(wf(run('gh pr list -R o/x'))), [])
})
test('clean: checkout present', () => {
  assert.deepEqual(findRepoless(wf(`      - uses: actions/checkout@abc\n${run('gh pr list')}`)), [])
})
test('gh api with explicit path is not inferring', () => {
  assert.deepEqual(findRepoless(wf(run('gh api "/repos/${GITHUB_REPOSITORY}/pulls"'))), [])
})
test('flagged: gh api with {owner}/{repo} placeholders', () => {
  assert.deepEqual(findRepoless(wf(run('gh api repos/{owner}/{repo}/pulls'))), ['workflow.yml:j'])
})
test('corpus: every real workflow is clean', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows')
  const bad = readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).flatMap(f => findRepoless(readFileSync(join(dir, f), 'utf8'), f))
  assert.deepEqual(bad, [])
})
