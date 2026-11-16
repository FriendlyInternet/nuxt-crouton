import { test } from 'node:test'
import assert from 'node:assert/strict'
import { epicRoute } from './epic-route.mjs'

test('epic → splitter dispatch, no build', () => {
  const r = epicRoute('work-this,epic,pkg:x')
  assert.equal(r.route, 'splitter')
  assert.equal(r.build, false)
  assert.deepEqual(r.dispatch, { workflow: 'decompose-on-issue-pidev.yml', harness: 'pi' })
})

test('non-epic → worker route, no dispatch', () => {
  const r = epicRoute('work-this,type:feature')
  assert.deepEqual(r, { route: 'worker', build: true, dispatch: null })
})

test('label match is exact, not substring', () => {
  assert.equal(epicRoute('epic-candidate,work-this').route, 'worker')
  assert.equal(epicRoute(['work-this', 'epic']).route, 'splitter')
})
