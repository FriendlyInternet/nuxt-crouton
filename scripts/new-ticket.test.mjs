import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkBody, labelsFor, newTicket, dedupQueries, parseLabelNames } from './new-ticket.mjs'

const KNOWN = ['type:feat', 'pkg:crouton-auth', 'app:docs', 'work-this']
const GOOD = '## Hypothesis\nx\n\n## 🧪 How to test\n1. Do the thing\n\nDedup-checked: foo\n'

function fakeExec({ hits = '', failOn } = {}) {
  const calls = []
  const exec = (file, args) => {
    calls.push(args.join(' '))
    if (failOn && args.join(' ').includes(failOn)) throw new Error('boom')
    if (args[0] === 'api' && args.includes('search/issues')) return hits
    if (args.includes('.number')) return '77'
    if (args.includes('.id')) return '9999'
    return ''
  }
  return { exec, calls }
}
const run = (opts, ex) => newTicket({ title: 'Ticket gate script', ...opts }, { exec: ex.exec, repo: 'o/r', knownLabels: KNOWN, log: () => {}, writeBody: () => '/tmp/x' })

test('missing How to test is refused and named', () => {
  const r = checkBody('Dedup-checked: x\n## Hypothesis\n', KNOWN)
  assert.ok(r.errors.some(e => /How to test/.test(e)))
})

test('packages/ path without Packages-approved only warns', () => {
  const body = `${GOOD}\nTouches packages/crouton-auth/x.ts`
  const r = checkBody(body, KNOWN)
  assert.equal(r.errors.length, 0)
  assert.ok(r.warnings.some(e => /Packages-approved/.test(e)))
  assert.ok(!checkBody(`${body}\nPackages-approved: yes\n`, KNOWN).warnings.some(e => /Packages-approved/.test(e)))
})

test('labels come only from the For agents section', () => {
  const inTest = '## For agents\n- edit apps/docs/x\n\n## 🧪 How to test\n1. open packages/crouton-auth/a\n'
  assert.deepEqual(labelsFor(inTest, KNOWN).labels, ['app:docs'])
  assert.deepEqual(labelsFor('## How to test\n1. packages/crouton-auth/a\n', KNOWN).labels, [])
  assert.deepEqual(checkBody(`${GOOD}\n1. packages/crouton-auth/a`, KNOWN).labels, [])
})

test('labels come from paths; unknown paths warn only', () => {
  const r = labelsFor('## For agents\npackages/crouton-auth/a apps/docs/b packages/nope/c', KNOWN)
  assert.deepEqual(r.labels.sort(), ['app:docs', 'pkg:crouton-auth'])
  assert.ok(r.warnings.some(w => w.includes('pkg:nope')))
})

test('well-formed tickets (emoji and plain headings) are not refused; hypothesis is warn-only', () => {
  assert.equal(checkBody(GOOD, KNOWN).errors.length, 0)
  assert.equal(checkBody('Dedup-checked: a\n## How to test\n1. step\n', KNOWN).errors.length, 0)
})

test('trigger label is LAST, after create and link', () => {
  const ex = fakeExec()
  const r = run({ body: GOOD, parent: 5 }, ex)
  assert.ok(r.ok)
  assert.match(ex.calls.at(-1), /labels\[\]=work-this/)
  assert.ok(ex.calls.findIndex(c => c.includes('sub_issues')) < ex.calls.length - 1)
})

test('trigger never added if an earlier call throws, nor on dry-run', () => {
  const ex = fakeExec({ failOn: 'sub_issues' })
  assert.throws(() => run({ body: GOOD, parent: 5 }, ex))
  assert.ok(!ex.calls.some(c => c.includes('work-this')))
  const ex2 = fakeExec()
  const r = run({ body: GOOD, dryRun: true }, ex2)
  assert.ok(r.ok && !ex2.calls.some(c => c.includes('POST')))
})

test('dedup hits block unless --force', () => {
  const ex = fakeExec({ hits: '12\tTicket gate' })
  const r = run({ body: GOOD }, ex)
  assert.equal(r.exitCode, 1)
  assert.ok(!ex.calls.some(c => c.includes('POST')))
  const ex2 = fakeExec({ hits: '12\tTicket gate' })
  assert.ok(run({ body: GOOD, force: true }, ex2).ok)
})

function ctxRun(parentBody, { failPatch = false } = {}) {
  const w = []
  const calls = []
  const exec = (file, args) => {
    calls.push(args.join(' '))
    if (args.includes('.body')) return parentBody
    if (failPatch && args.includes('PATCH')) throw new Error('nope')
    if (args[0] === 'api' && args.includes('search/issues')) return ''
    if (args.includes('.number')) return '77'
    if (args.includes('.id')) return '9999'
    return ''
  }
  const r = newTicket({ title: 'Ticket gate script', body: GOOD, parent: 5 }, { exec, repo: 'o/r', knownLabels: KNOWN, log: () => {}, writeBody: (b) => { w.push(b); return '/tmp/x' } })
  return { r, w, calls }
}

test('parent with an epic branch → child gets epic, depth+1, same branch', () => {
  const { r, w } = ctxRun('x\n<!-- pipeline: epic=5 depth=1 epic_branch=epic/5-x -->')
  assert.ok(r.ok)
  assert.match(w.at(-1), /<!-- pipeline: epic=5 depth=2 epic_branch=epic\/5-x -->/)
})

test('umbrella parent (no branch) → no pipeline line, no empty branch', () => {
  const { r, w, calls } = ctxRun('children are standalone')
  assert.ok(r.ok)
  assert.ok(w.every(b => !/pipeline:/.test(b)))
  assert.ok(!calls.some(c => c.includes('PATCH')))
})

test('failed body edit → trigger label NOT added', () => {
  const { r, calls } = ctxRun('<!-- pipeline: epic=5 depth=0 epic_branch=epic/5-x -->', { failPatch: true })
  assert.ok(!r.ok)
  assert.ok(!calls.some(c => c.includes('work-this')))
})

test('helpers', () => {
  assert.ok(dedupQueries('Add a ticket gate script for the planner').length <= 4)
  assert.deepEqual(parseLabelNames('- name: "pkg:a"\n  color: x\n- name: b\n'), ['pkg:a', 'b'])
})
