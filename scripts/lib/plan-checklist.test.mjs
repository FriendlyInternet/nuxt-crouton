/**
 * #3194 — the plan's `### Test` checklist and the `// covers: T<n>` reverse link.
 *   node --test scripts/lib/plan-checklist.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseChecklist, findCovers, coverageGaps } from './plan-checklist.mjs'

const T1 = '- [ ] T1 — two teams get separate keys — Run: `node --test a.test.mjs`'
const T2 = '- [x] T2 — the badge looks right — Manual: a person must see the colour'
const T3 = '- [ ] T3 — suite still runs — Run: `pnpm typecheck`'

// covers: T1
test('parseChecklist: valid checklist parsed in order', () => {
  const r = parseChecklist([T3, T1, T2].join('\n'))
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.items.map((i) => i.id), ['T3', 'T1', 'T2'])
  assert.deepEqual(r.items[1], { id: 'T1', what: 'two teams get separate keys', type: 'run', detail: 'node --test a.test.mjs' })
  assert.equal(r.items[2].type, 'manual')
  assert.equal(r.items[2].detail, 'a person must see the colour')
})

// covers: T1
test('parseChecklist: line with neither Run nor Manual is an error', () => {
  const r = parseChecklist([T1, '- [ ] T2 — something vague'].join('\n'))
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0], /T2.*Run.*Manual/)
  assert.ok(parseChecklist('foo.test.ts').errors.some((e) => /needs "Run:" or "Manual:"/.test(e)))
  assert.ok(parseChecklist('- [ ] T1 — x — Run: no backticks').errors.some((e) => /backticks/.test(e)))
  assert.ok(parseChecklist('- [ ] T1 — x — Manual:').errors.some((e) => /reason/.test(e)))
})

// covers: T1
test('parseChecklist: duplicate ID is an error', () => {
  const r = parseChecklist([T1, T1.replace('two teams', 'again')].join('\n'))
  assert.ok(r.errors.some((e) => /duplicate id T1/.test(e)))
})

// covers: T1
test('parseChecklist: no checklist lines is an error', () => {
  assert.match(parseChecklist('').errors[0], /must be a checklist/)
  assert.match(parseChecklist('   \n').errors[0], /must be a checklist/)
})

// covers: T1
test('parseChecklist: Manual-only checklist is valid', () => {
  const r = parseChecklist([T2, '- [ ] T5 — layout on a phone — Manual: no device in CI'].join('\n'))
  assert.deepEqual(r.errors, [])
  assert.equal(r.items.length, 2)
})

// covers: T1
test('parseChecklist: lone T0 Manual line is valid', () => {
  const r = parseChecklist('- [ ] T0 — no runnable test — Manual: config only, nothing to run')
  assert.deepEqual(r.errors, [])
  assert.equal(r.items[0].id, 'T0')
})

// covers: T1
test('parseChecklist: T0 beside other lines is an error', () => {
  const r = parseChecklist(['- [ ] T0 — no runnable test — Manual: none', T1].join('\n'))
  assert.ok(r.errors.some((e) => /T0/.test(e)))
  assert.ok(parseChecklist('- [ ] T0 — no runnable test — Run: `true`').errors.some((e) => /T0/.test(e)))
})

const ITEMS = parseChecklist([
  '- [ ] T1 — a — Run: `node --test scripts/a.test.mjs`',
  '- [ ] T2 — b — Run: `pnpm vitest run b.spec.ts`',
  '- [ ] T3 — c — Manual: look at it',
].join('\n')).items

// covers: T2
test('coverageGaps: all matched gives two empty lists', () => {
  assert.deepEqual(coverageGaps(ITEMS, ['T1', 'T2']), { untested: [], unknown: [] })
})

// covers: T2
test('coverageGaps: a dropped Run test case is in untested', () => {
  assert.deepEqual(coverageGaps(ITEMS, ['T1']), { untested: ['T2'], unknown: [] })
})

// covers: T2
test('coverageGaps: covers T9 with a checklist ending at T3 is in unknown', () => {
  assert.deepEqual(coverageGaps(ITEMS, ['T1', 'T2', 'T9']), { untested: [], unknown: ['T9'] })
})

// covers: T2
test('coverageGaps: a Run command with no test file is never untested', () => {
  const items = parseChecklist('- [ ] T1 — types — Run: `pnpm typecheck`').items
  assert.deepEqual(coverageGaps(items, []), { untested: [], unknown: [] })
})

// covers: T2
test('findCovers: reads several IDs from one covers comment', () => {
  const src = "// covers: T1, T3\ntest('x', () => {})\n  // covers: T3\n// covers T7 (no colon, ignored)"
  assert.deepEqual(findCovers(src), ['T1', 'T3'])
})
