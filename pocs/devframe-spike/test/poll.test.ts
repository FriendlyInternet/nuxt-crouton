import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pollWhileVisible } from '../client/poll'

// Minimal stand-ins for the dock iframe's document/window (node test env).
function fakeDoc(state: 'visible' | 'hidden' = 'visible') {
  const doc = new EventTarget() as EventTarget & { visibilityState: string }
  doc.visibilityState = state
  return doc
}
const setVisibility = (doc: any, state: 'visible' | 'hidden') => {
  doc.visibilityState = state
  doc.dispatchEvent(new Event('visibilitychange'))
}

describe('pollWhileVisible (dock re-fetches operations)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('re-fetches every 2 s while the dock is open', async () => {
    const tick = vi.fn()
    const stop = pollWhileVisible(tick, 2000, fakeDoc() as any, new EventTarget() as any)
    await vi.advanceTimersByTimeAsync(1999)
    expect(tick).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(tick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4000)
    expect(tick).toHaveBeenCalledTimes(3)
    stop()
  })

  it('stops when the dock closes (page hidden) and refreshes once on reopen', async () => {
    const tick = vi.fn()
    const doc = fakeDoc()
    const stop = pollWhileVisible(tick, 2000, doc as any, new EventTarget() as any)
    await vi.advanceTimersByTimeAsync(2000)
    expect(tick).toHaveBeenCalledTimes(1)
    setVisibility(doc, 'hidden')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(tick).toHaveBeenCalledTimes(1)
    setVisibility(doc, 'visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(tick).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(tick).toHaveBeenCalledTimes(3)
    stop()
  })

  it('stops when the dock iframe is torn down (pagehide)', async () => {
    const tick = vi.fn()
    const win = new EventTarget()
    pollWhileVisible(tick, 2000, fakeDoc() as any, win as any)
    win.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(tick).not.toHaveBeenCalled()
  })

  it('a newly created operation appears on the next poll without a reload', async () => {
    const rows: string[] = []
    const fetchOps = vi.fn(async () => [...rows])
    let rendered: string[] = await fetchOps()
    const stop = pollWhileVisible(async () => { rendered = await fetchOps() }, 2000, fakeDoc() as any, new EventTarget() as any)
    expect(rendered).toEqual([])
    rows.push('create spike-tasks')
    await vi.advanceTimersByTimeAsync(2000)
    expect(rendered).toEqual(['create spike-tasks'])
    stop()
    rows.push('update spike-tasks')
    await vi.advanceTimersByTimeAsync(4000)
    expect(rendered).toEqual(['create spike-tasks'])
  })
})
