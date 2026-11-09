import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chooseReviewTarget } from './resolve-review-epic.mjs'

const epics = [
  { number: 40, labels: ['epic', 'poc:status'] },
  { number: 30, labels: ['epic', 'app:velo'] },
  { number: 20, labels: ['epic', 'app:velo'] }
]

test('explicit review-pr wins', () => {
  assert.deepEqual(chooseReviewTarget({ app: 'velo', reviewPr: '7', epics }), { number: '7', source: 'review-pr' })
})
test('picks the app\'s to-test epic (lowest number)', () => {
  assert.equal(chooseReviewTarget({ app: 'velo', epics }).number, '20')
  assert.equal(chooseReviewTarget({ app: 'status', epics }).number, '40')
})
test('no epic for the app → empty (overlay off)', () => {
  assert.deepEqual(chooseReviewTarget({ app: 'kassa', epics }), { number: '', source: 'none' })
  assert.equal(chooseReviewTarget({ app: 'velo', epics: [] }).number, '')
})

// Real entry point: the workflow must gate the overlay on the resolved target, not on the raw input.
test('deploy-app.yml enables the overlay from the resolved target', () => {
  const wf = readFileSync(new URL('../.github/workflows/deploy-app.yml', import.meta.url), 'utf8')
  assert.match(wf, /id: review-target/)
  assert.match(wf, /NUXT_PUBLIC_CROUTON_REVIEW: \$\{\{ \(inputs\.environment == 'staging' && steps\.review-target\.outputs\.number != ''\)/)
  assert.doesNotMatch(wf, /NUXT_PUBLIC_CROUTON_REVIEW: \$\{\{[^}]*review-pr/)
})
