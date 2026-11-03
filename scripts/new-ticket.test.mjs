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

test('packages/ path needs Packages-approved', () => {
  const body = `${GOOD}\nTouches packages/crouton-auth/x.ts`
  assert.ok(checkBody(body, KNOWN).errors.some(e => /Packages-approved/.test(e)))
  assert.equal(checkBody(`${body}\nPackages-approved: yes\n`, KNOWN).errors.length, 0)
})

test('labels come from paths; unknown paths warn only', () => {
  const r = labelsFor('packages/crouton-auth/a apps/docs/b packages/nope/c', KNOWN)
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

test('--epic-branch stamps the hidden block; absent means none', () => {
  const w = []
  const go = (epicBranch) => newTicket({ title: 'Ticket gate script', body: GOOD, parent: 5, epicBranch }, { exec: fakeExec().exec, repo: 'o/r', knownLabels: KNOWN, log: () => {}, writeBody: (b) => { w.push(b); return '/tmp/x' } })
  go('epic/5-x'); go(undefined)
  assert.match(w[0], /epic_branch=epic\/5-x/)
  assert.doesNotMatch(w[1], /pipeline:/)
})

test('helpers', () => {
  assert.ok(dedupQueries('Add a ticket gate script for the planner').length <= 4)
  assert.deepEqual(parseLabelNames('- name: "pkg:a"\n  color: x\n- name: b\n'), ['pkg:a', 'b'])
})
