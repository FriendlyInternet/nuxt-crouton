import { describe, it, expect } from 'vitest'
import { parseDecisionsLog } from '../server/utils/decisions-core'

describe('parseDecisionsLog', () => {
  it('parses dash-dated lines with why and rejected', () => {
    const body = '## Decisions log\n- 2026-08-06 — Epic minted → decomposition belongs to the pipeline → rejected: hand-creating sub-issues\n\n## Next'
    expect(parseDecisionsLog(body, 2108)).toEqual([
      { date: '2026-08-06', epic: 2108, decision: 'Epic minted', why: 'decomposition belongs to the pipeline', rejected: 'hand-creating sub-issues' }
    ])
  })
  it('parses bracketed dates under an emoji "Decisions" heading', () => {
    const body = '## 🧭 Decisions\n\n- [2026-07-02] Model it as a habit → a box you tick kills the signal → (Rejected: new section — fatigue; Rejected: hook — same)'
    const [d] = parseDecisionsLog(body, 1129)
    expect(d).toMatchObject({ date: '2026-07-02', decision: 'Model it as a habit', why: 'a box you tick kills the signal' })
    expect(d!.rejected).toBe('new section — fatigue; hook — same')
  })
  it('ignores dated lines outside a decisions heading and empty bodies', () => {
    expect(parseDecisionsLog('## Notes\n- 2026-01-01 — nope', 1)).toEqual([])
    expect(parseDecisionsLog(null, 1)).toEqual([])
  })
})
