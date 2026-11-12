import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { holdHeightUntilRedrawn, changeWhileHeld } from '../app/utils/hold-height'
import type { HoldEnv } from '../app/utils/hold-height'

// The rule (#3813): the page does not move when the month changes. In WebKit
// that means the swipe container keeps its height until the month's redraw has
// really landed — which can be ~250 ms after the change — and the month change
// plus the track's snap-back happen in one go, so no frame shows the wrong month.

function fakeEnv(extra: Partial<HoldEnv> = {}) {
  let onChange: (() => void) | undefined
  let frames: Array<() => void> = []
  let disconnected = false
  const env: HoldEnv = {
    observe: (_body, cb) => {
      onChange = cb
      return () => { disconnected = true }
    },
    frame: cb => { frames.push(cb) },
    ...extra,
  }
  return {
    env,
    /** The month body's DOM changed (a redraw batch). */
    redraw: () => onChange?.(),
    /** Run one animation frame. */
    flushFrame: () => {
      const run = frames
      frames = []
      run.forEach(cb => cb())
    },
    get disconnected() { return disconnected },
  }
}

const el = (offsetHeight = 304, minHeight = '') => ({ offsetHeight, style: { minHeight } })

async function settled(p: Promise<void>) {
  let done = false
  void p.then(() => { done = true })
  await Promise.resolve()
  await Promise.resolve()
  return done
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('holdHeightUntilRedrawn (#3813)', () => {
  it('holds the current height at once, before any frame or timer', () => {
    const e = el(304)
    holdHeightUntilRedrawn(e, {}, fakeEnv().env)
    expect(e.style.minHeight).toBe('304px')
  })

  it('waits for a late redraw (~250 ms), then releases after 2 quiet frames', async () => {
    const e = el(304)
    const f = fakeEnv()
    const hold = holdHeightUntilRedrawn(e, {}, f.env)

    vi.advanceTimersByTime(250)
    for (let i = 0; i < 5; i++) f.flushFrame()
    expect(e.style.minHeight).toBe('304px')
    expect(await settled(hold.done)).toBe(false)

    f.redraw()
    f.flushFrame()
    expect(e.style.minHeight).toBe('304px')
    f.flushFrame()
    expect(e.style.minHeight).toBe('')
    expect(await settled(hold.done)).toBe(true)
    expect(f.disconnected).toBe(true)
  })

  it('a second redraw batch resets the quiet count', () => {
    const e = el(304)
    const f = fakeEnv()
    holdHeightUntilRedrawn(e, {}, f.env)
    f.redraw()
    f.flushFrame()
    f.redraw()
    f.flushFrame()
    expect(e.style.minHeight).toBe('304px')
    f.flushFrame()
    expect(e.style.minHeight).toBe('')
  })

  it('releases on the safety timeout when no redraw ever comes', () => {
    const e = el(304)
    holdHeightUntilRedrawn(e, {}, fakeEnv().env)
    vi.advanceTimersByTime(999)
    expect(e.style.minHeight).toBe('304px')
    vi.advanceTimersByTime(1)
    expect(e.style.minHeight).toBe('')
  })

  it("restores the author's own inline value", () => {
    const e = el(304, '10rem')
    const f = fakeEnv()
    holdHeightUntilRedrawn(e, {}, f.env)
    expect(e.style.minHeight).toBe('304px')
    f.redraw()
    f.flushFrame()
    f.flushFrame()
    expect(e.style.minHeight).toBe('10rem')
  })

  it('does nothing when there is nothing to hold', async () => {
    for (const target of [null, undefined]) {
      const hold = holdHeightUntilRedrawn(target, {}, fakeEnv().env)
      expect(await settled(hold.done)).toBe(true)
      expect(() => hold.release()).not.toThrow()
    }
    const unlaid = el(0)
    const hold = holdHeightUntilRedrawn(unlaid, {}, fakeEnv().env)
    expect(unlaid.style.minHeight).toBe('')
    expect(await settled(hold.done)).toBe(true)
  })

  it('a hold started while held still restores the original value', () => {
    const e = el(304)
    const f1 = fakeEnv()
    const f2 = fakeEnv()
    holdHeightUntilRedrawn(e, {}, f1.env)
    holdHeightUntilRedrawn(e, {}, f2.env)
    expect(e.style.minHeight).toBe('304px')
    f2.redraw()
    f2.flushFrame()
    f2.flushFrame()
    expect(e.style.minHeight).toBe('')
    // the first hold's late callbacks must not put a px value back
    f1.redraw()
    f1.flushFrame()
    f1.flushFrame()
    vi.advanceTimersByTime(2000)
    expect(e.style.minHeight).toBe('')
  })

  it('without a frame source (SSR) falls back to the timeout', () => {
    const e = el(304)
    const f = fakeEnv({ frame: undefined })
    // explicit undefined must not crash; observe still fires
    holdHeightUntilRedrawn(e, {}, { ...f.env, frame: undefined, timeoutMs: 500 })
    f.redraw()
    vi.advanceTimersByTime(499)
    expect(e.style.minHeight).toBe('304px')
    vi.advanceTimersByTime(1)
    expect(e.style.minHeight).toBe('')
  })
})

describe('changeWhileHeld (#3813)', () => {
  it('month change and snap-back run synchronously, while the height is held', async () => {
    const e = el(304)
    const f = fakeEnv()
    const record: string[] = []
    const seen: string[] = []
    const p = changeWhileHeld(e, {}, () => {
      record.push('fire')
      seen.push(e.style.minHeight)
      record.push('snap')
      seen.push(e.style.minHeight)
    }, f.env)
    // complete before any await: no frame can fall between change and snap-back
    expect(record).toEqual(['fire', 'snap'])
    expect(seen).toEqual(['304px', '304px'])
    expect(await settled(p)).toBe(false)

    f.redraw()
    f.flushFrame()
    f.flushFrame()
    expect(await settled(p)).toBe(true)
    expect(e.style.minHeight).toBe('')
  })

  // WebKit only keeps the page scroll when the pin is laid out BEFORE the redraw
  // (PR preview, WebKit iPhone: pin without a layout 0/4, pin + layout 15/15).
  // Reading offsetHeight is what makes the browser lay it out.
  it('lays the pin out (reads offsetHeight after pinning) before the change runs', () => {
    const log: string[] = []
    const e = {
      style: { minHeight: '' },
      get offsetHeight() {
        log.push(`read@${this.style.minHeight || 'auto'}`)
        return 304
      },
    }
    changeWhileHeld(e, {}, () => { log.push('change') }, fakeEnv().env)
    const change = log.indexOf('change')
    expect(change).toBeGreaterThan(0)
    expect(log.slice(0, change)).toContain('read@304px')
  })

  it('a throwing change releases the hold and rethrows', () => {
    const e = el(304)
    expect(() => changeWhileHeld(e, {}, () => { throw new Error('boom') }, fakeEnv().env)).toThrow('boom')
    expect(e.style.minHeight).toBe('')
  })
})
