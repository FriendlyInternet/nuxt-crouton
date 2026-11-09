import { describe, it, expect } from 'vitest'
import { classifyNow, holdReason, type NowInput } from '../server/utils/now-core'

const base: NowInput = { pulls: [], workIssues: [], blockedIssues: [], runs: [], comments: {} }
const issue = (n: number, labels: string[] = []) => ({ number: n, title: `t${n}`, html_url: `u${n}`, labels: labels.map(name => ({ name })) })
const pr = (n: number, o: object = {}) => ({ number: n, title: `pr${n}`, html_url: `p${n}`, head: { ref: `work-${n}` }, user: { login: 'nuxt-harness', type: 'Bot' }, ...o })

describe('classifyNow', () => {
  it('a running work run lands in Now, not Next', () => {
    const r = classifyNow({ ...base, workIssues: [issue(5, ['work-this'])], runs: [{ display_title: '#5 · build', html_url: 'r' }] })
    expect(r.now).toMatchObject([{ number: 5, step: 'Building' }])
    expect(r.next).toEqual([])
  })
  it('work-this with no PR and no run lands in Next; with an open PR it does not', () => {
    const r = classifyNow({ ...base, workIssues: [issue(7), issue(8)], pulls: [pr(20, { body: 'Closes #8' })] })
    expect(r.next.map(n => n.number)).toEqual([7])
    expect(r.now.map(n => n.number)).toEqual([20])
  })
  it('blocked issues are Waiting with the heading as reason, never Next', () => {
    const r = classifyNow({
      ...base, workIssues: [issue(9, ['work-this', 'status:blocked'])], blockedIssues: [issue(9)],
      comments: { 9: [{ body: '## 🔀 Blocked — pick A or B\n**Needs:** answer' }] }
    })
    expect(r.waiting).toMatchObject([{ number: 9, reason: 'pick A or B' }])
    expect(r.next).toEqual([])
  })
  const finalHold = { body: '<!-- build-review-sha:abc -->\n<!-- build-review-verdict:no-go -->\n<!-- build-review-final -->\n🔴 **Build rejected twice** — needs you', created_at: '2026-11-01T10:00:00Z', user: { login: 'nuxt-harness[bot]', type: 'Bot' } }
  it('a final review hold (decideReview says wait) puts a PR in Waiting, not Now', () => {
    const r = classifyNow({ ...base, pulls: [pr(30, { head: { ref: 'work-30', sha: 'abc' } })], comments: { 30: [finalHold] } })
    expect(r.waiting).toMatchObject([{ number: 30, kind: 'pr' }])
    expect(r.now).toEqual([])
  })
  it('once the owner says ok after the hold, the PR is no longer waiting for the owner', () => {
    const ok = { body: 'ok', created_at: '2026-11-02T10:00:00Z', user: { login: 'pmcp', type: 'User' } }
    const r = classifyNow({ ...base, pulls: [pr(30, { head: { ref: 'work-30', sha: 'abc' } })], comments: { 30: [finalHold, ok] } })
    expect(r.waiting).toEqual([])
    expect(r.now.map(n => n.number)).toEqual([30])
  })
  it('a PR whose ticket is blocked for the owner is Waiting with the ticket reason, not Now', () => {
    const r = classifyNow({
      ...base, pulls: [pr(40, { body: 'Closes #9', head: { ref: 'work-9', sha: 'zzz' } })], blockedIssues: [issue(9)],
      comments: { 9: [{ body: '## 🔀 Blocked — pick A or B\n**Needs:** answer' }] }
    })
    expect(r.waiting.find(w => w.number === 40)).toMatchObject({ kind: 'pr', reason: 'pick A or B' })
    expect(r.now).toEqual([])
  })
  it('Next is grouped by epic (from the ticket marker) then number; plan:approved tickets are included', () => {
    const e = (n: number, epic: number) => ({ ...issue(n), body: `<!-- pipeline: epic=${epic} depth=1 -->` })
    const r = classifyNow({ ...base, workIssues: [e(12, 2), e(11, 1)], approvedIssues: [e(10, 2), e(11, 1)] })
    expect(r.next.map(n => [n.epic, n.number])).toEqual([[1, 11], [2, 10], [2, 12]])
  })
  it('ignores non-pipeline PRs', () => {
    const r = classifyNow({ ...base, pulls: [pr(31, { user: { login: 'someone', type: 'User' } })] })
    expect(r.now).toEqual([])
  })
})

describe('holdReason', () => {
  it('falls back to the first prose line', () => {
    expect(holdReason('> 🤖 header\nNeeds your call on X')).toBe('Needs your call on X')
    expect(holdReason(null)).toBe('')
  })
})
