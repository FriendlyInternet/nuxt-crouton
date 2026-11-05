import { test } from 'node:test'
import assert from 'node:assert/strict'
import { issuesWithRecentRun, staleWorkThis } from './stale-work-this.mjs'
import { renderStuckSections } from '../../.claude/skills/housekeeping/stuck-render.mjs'

const NOW = Date.parse('2026-11-05T12:00:00Z')
const ago = (h) => new Date(NOW - h * 3600000).toISOString()
const issue = (o = {}) => ({
  number: 10, title: 't', html_url: 'u', labels: ['work-this'], labeledAt: ago(3), openPr: false, ...o
})
const run = (n, conclusion, mode = 'build') => ({ display_title: `#${n} · ${mode}`, conclusion })
const list = (issues, extra = {}) => staleWorkThis({ issues, now: NOW, ...extra })

test('R1: only a skipped run exists → listed', () => {
  const recentRunIssues = issuesWithRecentRun([run(10, 'skipped')])
  assert.equal(list([issue()], { recentRunIssues }).length, 1)
})
test('R2: canary never listed', () => {
  const i = issue({ number: 1932, labeledAt: ago(288) })
  assert.equal(list([i], { canaryIssues: new Set([1932]) }).length, 0)
})
test('R3: status:blocked never listed', () => {
  assert.equal(list([issue({ labels: ['work-this', 'status:blocked'] })]).length, 0)
})
test('listed with age', () => {
  assert.equal(list([issue()])[0].labelAgeHours, 3)
})
test('too young', () => assert.equal(list([issue({ labeledAt: ago(0.5) })]).length, 0))
test('open PR', () => assert.equal(list([issue({ openPr: true })]).length, 0))
test('real or active run', () => {
  for (const c of ['success', null]) {
    const recentRunIssues = issuesWithRecentRun([run(10, c)])
    assert.equal(list([issue()], { recentRunIssues }).length, 0)
  }
})
test('issuesWithRecentRun matching', () => {
  const s = issuesWithRecentRun([run(30, 'success'), run(3006, 'failure', 'plan · revise'), run(7, 'skipped'), run(8, null)])
  assert.deepEqual([...s].sort((a, b) => a - b), [8, 30, 3006])
  assert.equal(s.has(3), false)
})
test('epic / no work-this → not listed', () => {
  assert.equal(list([issue({ labels: ['work-this', 'epic'] })]).length, 0)
  assert.equal(list([issue({ labels: [] })]).length, 0)
})
test('in-progress flagged', () => {
  assert.equal(list([issue({ labels: ['work-this', 'status:in-progress'] })])[0].inProgress, true)
})
test('oldest first', () => {
  const r = list([issue({ number: 1, labeledAt: ago(5) }), issue({ number: 2, labeledAt: ago(50) })])
  assert.deepEqual(r.map((x) => x.number), [2, 1])
})
test('render', () => {
  const items = [
    { number: 1, title: 'a', url: 'u', labelAgeHours: 3, inProgress: true },
    { number: 2, title: 'b', url: 'u', labelAgeHours: 96, inProgress: false }
  ]
  const [[h, lines]] = renderStuckSections({ staleWorkThis: items })
  assert.match(h, /Forgotten work-this/)
  assert.match(lines[0], /gh workflow run work-issue-pidev\.yml/)
  assert.match(lines[0], /Don't remove and re-add/)
  assert.match(lines[1], /for 3h/)
  assert.match(lines[1], /⛔/)
  assert.match(lines[2], /for 4d/)
  assert.doesNotMatch(lines[2], /⛔/)
  assert.deepEqual(renderStuckSections({ staleWorkThis: [] }), [])
  assert.match(renderStuckSections({ staleWorkThis: null })[0][1][0], /unavailable/)
})
