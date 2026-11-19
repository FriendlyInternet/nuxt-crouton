import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLookAt, previewApps, decideSignoff, fillPr, surfaceLine } from './signoff-surface.mjs'

const VELO = '👁 What to look at: velo /dashboard/test1 — you should see the new empty-state card'
const NINE = ['kassa', 'velo', 'booking-demo', 'crate', 'crouton-builder', 'gallery', 'pins', 'snippets', 'status']

test('named page on a previewed app is held with one link + sight', () => {
  const d = decideSignoff({ uiTouched: 1, planText: `### Fix\n${VELO}`, issueBody: '', previewApps: ['velo'] })
  assert.equal(d.hold, true)
  assert.equal(d.link, 'https://status.pmcp.dev/api/status/login/velo?key=pr{{PR}}&to=%2Fdashboard%2Ftest1')
  assert.ok(d.note.includes(d.link))
  assert.ok(d.note.includes('you should see the new empty-state card'))
  assert.ok(d.note.includes('<!-- deploy-preview: full-watch -->'))
})

test('the #3524 shape (no 👁 line) is not held', () => {
  const d = decideSignoff({ uiTouched: 1, planText: '### Fix\nadd alert', issueBody: 'How to test: see 🧪', previewApps: NINE })
  assert.equal(d.hold, false)
  assert.ok(d.note.includes('not held for sign-off'))
  assert.ok(!d.note.includes('full-watch'))
})

test('explicit none is not held and says why', () => {
  const d = decideSignoff({ uiTouched: 1, planText: '👁 What to look at: none — only renders when a repeater names a missing component', previewApps: NINE })
  assert.equal(d.hold, false)
  assert.ok(d.note.includes('only renders when a repeater names a missing component'))
})

test('non-visual diff yields nothing', () => {
  const d = decideSignoff({ uiTouched: 0, planText: VELO, previewApps: ['velo'] })
  assert.equal(d.hold, false)
  assert.equal(d.note, '')
})

test('plan wins over issue', () => {
  const d = decideSignoff({ uiTouched: 1, planText: VELO, issueBody: '👁 What to look at: kassa /x — you should see y', previewApps: ['velo', 'kassa'] })
  assert.equal(d.lookAt.app, 'velo')
})

test('no sight is not held', () => {
  const d = decideSignoff({ uiTouched: 1, planText: '👁 What to look at: velo /x', previewApps: ['velo'] })
  assert.equal(d.hold, false)
})

test('unsafe input is treated as missing', () => {
  assert.equal(parseLookAt('👁 What to look at: Velo /x — you should see y'), null)
  assert.equal(parseLookAt('👁 What to look at: velo //evil.com — you should see y'), null)
  assert.equal(parseLookAt('👁 What to look at: velo /a\u0001b — you should see y'), null)
  assert.equal(decideSignoff({ uiTouched: 1, planText: '👁 What to look at: velo //evil.com — you should see y', previewApps: ['velo'] }).hold, false)
})

test('named app without a preview is not held and has no link', () => {
  const d = decideSignoff({ uiTouched: 1, planText: VELO, previewApps: ['snippets'] })
  assert.equal(d.hold, false)
  assert.equal(d.reason, 'no-preview')
  assert.ok(d.note.includes('velo'))
  assert.ok(!d.note.includes('status.pmcp.dev'))
})

test('preview set matches the deploy rule', () => {
  assert.deepEqual(previewApps(['apps/velo/app/pages/x.vue']), ['velo'])
  const p = previewApps(['packages/crouton-core/app/components/FormRepeater.vue'])
  assert.ok(p.includes('velo') && p.includes('snippets'))
})

test('fillPr fills the placeholder', () => {
  assert.equal(fillPr('a key=pr{{PR}}&b', 42), 'a key=pr42&b')
  assert.equal(fillPr('nothing', 42), 'nothing')
})

test('path is normalised', () => {
  assert.equal(parseLookAt('👁 What to look at: velo dashboard/test1 — you should see z').path, '/dashboard/test1')
})

test('surfaceLine: the PR names its page whenever the plan does, held or not (#4201)', () => {
  const noSight = decideSignoff({ uiTouched: 1, planText: '👁 What to look at: velo /dashboard/test1', previewApps: ['velo'] })
  assert.equal(noSight.hold, false)
  assert.equal(surfaceLine(noSight, ['velo']), '<!-- review-surface: velo /dashboard/test1 -->')
  const none = decideSignoff({ uiTouched: 1, planText: '👁 What to look at: none — scripts only', previewApps: ['velo'] })
  assert.equal(surfaceLine(none, ['velo']), '<!-- review-surface-none: scripts only -->')
  // #4252: no reason in the plan → the bare marker; a reason can never close the marker early.
  const bare = decideSignoff({ uiTouched: 1, planText: '👁 What to look at: none', previewApps: ['velo'] })
  assert.equal(surfaceLine(bare, ['velo']), '<!-- review-surface-none -->')
  const sneaky = decideSignoff({ uiTouched: 1, planText: '👁 What to look at: none — a --> b', previewApps: ['velo'] })
  assert.equal(surfaceLine(sneaky, ['velo']), '<!-- review-surface-none: a -->')
  const elsewhere = decideSignoff({ uiTouched: 1, planText: VELO, previewApps: ['kassa'] })
  assert.equal(surfaceLine(elsewhere, ['kassa']), '')
  const notVisual = decideSignoff({ uiTouched: 0, planText: VELO, previewApps: ['velo'] })
  assert.equal(surfaceLine(notVisual, ['velo']), '')
})
