import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ensureWorkflowChangeLine } from './workflow-change-line.mjs'

const W = '.github/workflows/'

test('adds the line, keeps Closes first', () => {
  const r = ensureWorkflowChangeLine({ body: 'Closes #1\n\ntext', files: [`${W}x.yml`, 'scripts/a.mjs'], title: 'T', issue: 1 })
  assert.equal(r.added, true)
  assert.match(r.body, /^Workflow-change: .*`x\.yml`/m)
  assert.ok(r.body.startsWith('Closes #1'))
})

test('existing line (any case) is left alone', () => {
  for (const b of ['Closes #1\nWorkflow-change: because', 'Closes #1\nworkflow-change: because']) {
    const r = ensureWorkflowChangeLine({ body: b, files: [`${W}x.yml`], title: 'T', issue: 1 })
    assert.equal(r.added, false)
    assert.equal(r.body, b)
  }
})

test('non-workflow paths do nothing', () => {
  const b = 'Closes #1'
  const r = ensureWorkflowChangeLine({ body: b, files: ['scripts/a.mjs', '.github/actions/foo/action.yml'], title: 'T', issue: 1 })
  assert.equal(r.added, false)
  assert.equal(r.body, b)
})

test('names each workflow once, in order', () => {
  const r = ensureWorkflowChangeLine({ body: 'Closes #1', files: [`${W}a.yml`, `${W}b.yml`, `${W}a.yml`], title: 'T', issue: 1 })
  assert.match(r.body, /`a\.yml`, `b\.yml` \(#1\)/)
  assert.equal(r.body.split('`a.yml`').length, 2)
})

test('strips the review-feedback suffix', () => {
  const r = ensureWorkflowChangeLine({ body: 'Closes #1', files: [`${W}a.yml`], title: 'Foo (review feedback)', issue: 1 })
  assert.match(r.body, /Workflow-change: Foo — edits/)
})

test('finish step is wired', () => {
  const y = readFileSync(new URL('../../.github/workflows/work-issue-pidev.yml', import.meta.url), 'utf8')
  assert.ok(y.includes('workflow-change-line.mjs" --pr "$PRNUM"'))
  assert.ok(y.includes('cp scripts/lib/workflow-change-line.mjs'))
})
