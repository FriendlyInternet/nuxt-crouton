import { describe, it, expect } from 'vitest'
import { buildWalkReply } from '../server/utils/walk-result-core'

describe('buildWalkReply', () => {
  it('all works → ok on the ref epic', () => {
    expect(buildWalkReply({ ref: '#2682', steps: [{ text: 'a', verdict: 'works' }, { text: 'b', verdict: 'works' }] }).data)
      .toEqual({ kind: 'issue', number: 2682, body: 'ok' })
  })
  it('one issue → "not ok: <step> — <note>"', () => {
    expect(buildWalkReply({ ref: '#5', steps: [{ text: 'Tap save', verdict: 'issue', note: 'nothing happens' }, { text: 'b', verdict: 'works' }] }).data?.body)
      .toBe('not ok: Tap save — nothing happens')
  })
  it('several issues → one line each', () => {
    const body = buildWalkReply({ ref: '#5', steps: [{ text: 'a', verdict: 'issue', note: 'x' }, { text: 'b', verdict: 'issue' }] }).data?.body
    expect(body).toBe('not ok: a — x\nb')
  })
  it('no ref → no post, no error', () => {
    expect(buildWalkReply({ ref: '', steps: [{ text: 'a', verdict: 'works' }] })).toEqual({ data: null, error: null })
    expect(buildWalkReply({ steps: [] })).toEqual({ data: null, error: null })
  })
  it('rejects a bad ref and unmarked steps', () => {
    expect(buildWalkReply({ ref: 'abc', steps: [{ text: 'a', verdict: 'works' }] }).error).toBeTruthy()
    expect(buildWalkReply({ ref: '#1', steps: [{ text: 'a' }] }).error).toBeTruthy()
  })
})
