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
  it('a final-hold verdict puts a PR in Waiting, not Now', () => {
    const r = classifyNow({ ...base, pulls: [pr(30)], comments: { 30: [{ body: 'Review rejected twice. Held for you.' }] } })
    expect(r.waiting).toMatchObject([{ number: 30, kind: 'pr', reason: 'Review rejected twice. Held for you.' }])
    expect(r.now).toEqual([])
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
