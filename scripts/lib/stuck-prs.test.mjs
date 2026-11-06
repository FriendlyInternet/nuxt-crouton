import { test } from 'node:test'
import assert from 'node:assert/strict'
import { epicNoCi, okButConflicting } from './stuck-prs.mjs'
import { renderStuckSections } from '../../.claude/skills/housekeeping/stuck-render.mjs'

const NOW = Date.parse('2026-11-03T12:00:00Z')
const ago = (d) => new Date(NOW - d * 86400000).toISOString()

const epicPr = (o = {}) => ({
  number: 1, title: 't', html_url: 'u', created_at: ago(5), headCommitDate: ago(5),
  base: 'main', head: 'epic/1-x', checkRunNames: [], ...o
})

test('epicNoCi: listed / CI Gate / young / wrong shape', () => {
  assert.equal(epicNoCi({ prs: [epicPr()], now: NOW }).length, 1)
  assert.equal(epicNoCi({ prs: [epicPr({ checkRunNames: ['CI Gate'] })], now: NOW }).length, 0)
  assert.equal(epicNoCi({ prs: [epicPr({ created_at: ago(2), headCommitDate: ago(2) })], now: NOW }).length, 0)
  assert.equal(epicNoCi({ prs: [epicPr({ head: 'work-1' })], now: NOW }).length, 0)
  assert.equal(epicNoCi({ prs: [epicPr({ base: 'epic/2-y' })], now: NOW }).length, 0)
})

const ok = (d, body = 'ok') => ({ user: { login: 'pmcp', type: 'User' }, body, created_at: ago(d) })
const commit = (d, extra = {}) => ({ parents: [1], files: ['a.ts'], commit: { committer: { date: ago(d) }, message: 'x' }, ...extra })
const base = { pr: { number: 2, title: 't', html_url: 'u', mergeable_state: 'dirty' }, owner: 'pmcp', now: NOW }

test('okButConflicting cases', () => {
  assert.ok(okButConflicting({ ...base, comments: [ok(2)], commits: [commit(3)] }))
  assert.equal(okButConflicting({ ...base, comments: [], commits: [] }), null)
  assert.equal(okButConflicting({ ...base, comments: [ok(2)], commits: [commit(1)] }), null) // worker revision
  const ciFix = commit(1, { commit: { committer: { date: ago(1), name: 'claude[bot]' }, message: 'fix\n\nCI-Fix: true' } })
  assert.ok(okButConflicting({ ...base, comments: [ok(2)], commits: [ciFix] }))
  assert.equal(okButConflicting({ ...base, comments: [ok(3), ok(2, 'not ok: no')], commits: [] }), null)
  assert.equal(okButConflicting({ ...base, pr: { ...base.pr, mergeable_state: 'unknown' }, comments: [ok(2)], commits: [] }), null)
  assert.equal(okButConflicting({ ...base, pr: { ...base.pr, mergeable_state: 'clean' }, comments: [ok(2)], commits: [] }), null)
  assert.equal(okButConflicting({ ...base, comments: [ok(0.25)], commits: [] }), null)
})

test('render: both sections with the question; empty yields none', () => {
  const out = renderStuckSections({
    epicPrsNoCi: [{ number: 5, title: 'e', url: 'u', ageDays: 6 }],
    okedPrsConflicting: [{ number: 6, title: 'o', url: 'u', okAgeDays: 3 }]
  })
  assert.equal(out.length, 2)
  assert.ok(out.every(([, lines]) => lines.join('\n').includes('resume or close?')))
  assert.deepEqual(renderStuckSections({}), [])
})
