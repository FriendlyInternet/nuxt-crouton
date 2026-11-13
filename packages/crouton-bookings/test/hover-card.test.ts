/**
 * #3895 — one shared hover card for the calendar. The card has no trigger element of its
 * own (reka never closes a trigger-less hover card by itself), so createHoverCard owns
 * the open/close timing. Rules R1–R4 from the ticket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHoverCard, type HoverCardState } from '../app/utils/hover-card'

const A = {} as Element
const B = {} as Element
const mouse = { pointerType: 'mouse' }
const pen = { pointerType: 'pen' }
const touch = { pointerType: 'touch' }

function setup() {
  const changes: HoverCardState<string>[] = []
  const card = createHoverCard<string>({ openDelay: 300, closeDelay: 100, onChange: s => changes.push(s) })
  const last = () => changes[changes.length - 1]
  const isOpen = () => last()?.open ?? false
  return { card, changes, last, isOpen }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('createHoverCard — R1 no touch', () => {
  it('a touch enter never opens', () => {
    const { card, isOpen, changes } = setup()
    card.triggerEnter(touch, A, 'a')
    vi.advanceTimersByTime(10_000)
    expect(isOpen()).toBe(false)
    expect(changes).toHaveLength(0)
  })

  it('a mouse enter opens after 300 ms', () => {
    const { card, isOpen } = setup()
    card.triggerEnter(mouse, A, 'a')
    vi.advanceTimersByTime(300)
    expect(isOpen()).toBe(true)
  })

  it('a pen enter opens after 300 ms', () => {
    const { card, isOpen } = setup()
    card.triggerEnter(pen, A, 'a')
    vi.advanceTimersByTime(300)
    expect(isOpen()).toBe(true)
  })

  it('touch leave/card events are ignored', () => {
    const { card, isOpen } = setup()
    card.triggerEnter(mouse, A, 'a')
    vi.advanceTimersByTime(300)
    card.triggerLeave(touch)
    card.cardLeave(touch)
    vi.advanceTimersByTime(1000)
    expect(isOpen()).toBe(true)
  })
})

describe('createHoverCard — R2 open', () => {
  it('is closed at 299 ms and open at 300 ms with the anchor and data', () => {
    const { card, isOpen, last } = setup()
    card.triggerEnter(mouse, A, 'a')
    vi.advanceTimersByTime(299)
    expect(isOpen()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(last()).toEqual({ open: true, anchor: A, data: 'a' })
  })

  it('moving from A to B closes A after 100 ms and opens B 300 ms after entering it', () => {
    const { card, isOpen, last } = setup()
    card.triggerEnter(mouse, A, 'a')
    vi.advanceTimersByTime(300)
    card.triggerLeave(mouse)
    vi.advanceTimersByTime(50)
    card.triggerEnter(mouse, B, 'b')
    vi.advanceTimersByTime(49)
    expect(isOpen()).toBe(true)
    vi.advanceTimersByTime(1) // +100 from leaving A
    expect(isOpen()).toBe(false)
    vi.advanceTimersByTime(249) // +299 from entering B
    expect(isOpen()).toBe(false)
    vi.advanceTimersByTime(1) // +300 from entering B
    expect(last()).toEqual({ open: true, anchor: B, data: 'b' })
  })

  it('re-entering the same anchor within 100 ms keeps it open', () => {
    const { card, isOpen } = setup()
    card.triggerEnter(mouse, A, 'a')
    vi.advanceTimersByTime(300)
    card.triggerLeave(mouse)
    vi.advanceTimersByTime(50)
    card.triggerEnter(mouse, A, 'a')
    vi.advanceTimersByTime(1000)
    expect(isOpen()).toBe(true)
  })
})

describe('createHoverCard — R3 close', () => {
  it('leaving closes after 100 ms', () => {
    const { card, isOpen } = setup()
    card.triggerEnter(mouse, A, 'a')
    vi.advanceTimersByTime(300)
    card.triggerLeave(mouse)
    vi.advanceTimersByTime(99)
    expect(isOpen()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isOpen()).toBe(false)
  })

  it('entering the card keeps it open; leaving the card closes after 100 ms', () => {
    const { card, isOpen } = setup()
    card.triggerEnter(mouse, A, 'a')
    vi.advanceTimersByTime(300)
    card.triggerLeave(mouse)
    vi.advanceTimersByTime(50)
    card.cardEnter(mouse)
    vi.advanceTimersByTime(1000)
    expect(isOpen()).toBe(true)
    card.cardLeave(mouse)
    vi.advanceTimersByTime(99)
    expect(isOpen()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isOpen()).toBe(false)
  })

  it('leaving before 300 ms never opens', () => {
    const { card, changes } = setup()
    card.triggerEnter(mouse, A, 'a')
    vi.advanceTimersByTime(200)
    card.triggerLeave(mouse)
    vi.advanceTimersByTime(10_000)
    expect(changes.some(c => c.open)).toBe(false)
  })
})

describe('createHoverCard — R4 close()', () => {
  it('closes at once and keeps the last anchor and data', () => {
    const { card, isOpen, last } = setup()
    card.triggerEnter(mouse, A, 'a')
    vi.advanceTimersByTime(300)
    card.close()
    expect(isOpen()).toBe(false)
    expect(last()).toEqual({ open: false, anchor: A, data: 'a' })
  })

  it('a pending open does not fire after close()', () => {
    const { card, last, changes } = setup()
    card.triggerEnter(mouse, A, 'a')
    vi.advanceTimersByTime(300)
    card.triggerLeave(mouse)
    card.triggerEnter(mouse, B, 'b')
    card.close()
    const count = changes.length
    vi.advanceTimersByTime(10_000)
    expect(changes).toHaveLength(count)
    expect(last()).toEqual({ open: false, anchor: A, data: 'a' })
  })

  it('a pending first open does not fire after close()', () => {
    const { card, changes } = setup()
    card.triggerEnter(mouse, A, 'a')
    card.close()
    vi.advanceTimersByTime(10_000)
    expect(changes.some(c => c.open)).toBe(false)
  })
})
