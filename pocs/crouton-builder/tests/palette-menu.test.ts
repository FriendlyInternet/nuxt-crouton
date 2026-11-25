import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { usePaletteMenu } from '../app/utils/palette-menu'

// How-to-test steps 2 and 3 (#3748): tap a menu item to add it; hold one, drag it
// onto a pane edge, and the menu is gone. Driven through the REAL board drag
// (`useBoardDrag` — the same arm / hold / drop / click-swallow the page uses);
// only the browser surface it touches (window listeners, elementFromPoint) is a
// minimal stand-in, because the suite runs in node.

type Handler = (ev: unknown) => void
let listeners: Record<string, Handler[]> = {}
const fire = (type: string, ev: unknown) => [...(listeners[type] ?? [])].forEach(h => h(ev))

// One board pane at path [0], 100×100 at the origin — not inside a board frame
// (#3916), so the drag takes the plain pane-under-the-finger path.
const pane = {
  dataset: { path: '0' },
  closest: (sel: string) => (sel === '[data-handoff="board-pane"]' ? pane : null),
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
}
const chip = { setPointerCapture() {}, releasePointerCapture() {} }
const down = (pointerType = 'touch') =>
  ({ button: 0, pointerId: 1, clientX: 50, clientY: 50, pointerType, currentTarget: chip }) as unknown as PointerEvent

let useBoardDrag: typeof import('../app/utils/board-drag').useBoardDrag

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).ref = ref // board-drag relies on Nuxt's auto-import
  ;({ useBoardDrag } = await import('../app/utils/board-drag'))
})

beforeEach(() => {
  vi.useFakeTimers()
  listeners = {}
  ;(globalThis as Record<string, unknown>).window = {
    addEventListener: (t: string, h: Handler) => { (listeners[t] ??= []).push(h) },
    removeEventListener: (t: string, h: Handler) => { listeners[t] = (listeners[t] ?? []).filter(x => x !== h) },
  }
  ;(globalThis as Record<string, unknown>).document = { elementFromPoint: () => pane }
})
afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as Record<string, unknown>).window
  delete (globalThis as Record<string, unknown>).document
})

function setup() {
  const drag = useBoardDrag()
  const added: string[] = []
  const dropped: { path: number[], edge: string, blockId: string }[] = []
  drag.onDrop((path, edge, p) => dropped.push({ path, edge, blockId: p.kind === 'block' ? p.blockId : '' }))
  // As the page wires it: a tap adds unless it's the click that ends a drag.
  const menu = usePaletteMenu(drag.payload, (id) => { if (!drag.consumeClick()) added.push(id) })
  const hold = (blockId: string) => drag.arm(down(), { kind: 'block', blockId, label: blockId }, { holdMs: 250 })
  return { drag, menu, added, dropped, hold }
}

describe('palette menu — tap and hold-and-drag (#3748)', () => {
  it('tapping a menu item closes the menu and adds that block', () => {
    const { menu, added } = setup()
    menu.setGroupOpen('Artists', true)
    expect(menu.openGroup.value).toBe('Artists')
    menu.onItemClick('artists-form')
    expect(added).toEqual(['artists-form'])
    expect(menu.openGroup.value).toBeNull()
  })

  it('holding an item arms the drag; the menu goes see-through and can\'t close mid-drag', () => {
    const { drag, menu, hold } = setup()
    menu.setGroupOpen('Artists', true)
    hold('artists-list')
    expect(drag.payload.value).toBeNull() // not before the hold
    vi.advanceTimersByTime(250)
    expect(drag.payload.value).toMatchObject({ kind: 'block', blockId: 'artists-list' })
    expect(menu.dragging.value).toBe(true)
    // The popover asks to close as the finger leaves it — ignored while dragging.
    menu.setGroupOpen('Artists', false)
    expect(menu.openGroup.value).toBe('Artists')
  })

  it('dropping it on a pane edge places the block, and the menu is gone', () => {
    const { drag, menu, dropped, added, hold } = setup()
    menu.setGroupOpen('Artists', true)
    hold('artists-list')
    vi.advanceTimersByTime(250)
    fire('pointermove', { pointerId: 1, clientX: 95, clientY: 50, preventDefault() {} })
    fire('pointerup', { pointerId: 1, clientX: 95, clientY: 50 })
    expect(dropped).toEqual([{ path: [0], edge: 'right', blockId: 'artists-list' }])
    expect(drag.payload.value).toBeNull()
    expect(menu.dragging.value).toBe(false)
    expect(menu.openGroup.value).toBeNull()
    // The click that follows the drag's pointerup doesn't add it a second time.
    menu.onItemClick('artists-list')
    expect(added).toEqual([])
  })

  it('a quick swipe on an item is a scroll, not a drag: the menu stays open', () => {
    const { drag, menu, dropped, hold } = setup()
    menu.setGroupOpen('Artists', true)
    hold('artists-list')
    fire('pointermove', { pointerId: 1, clientX: 80, clientY: 50, preventDefault() {} })
    vi.advanceTimersByTime(250)
    expect(drag.payload.value).toBeNull()
    expect(menu.openGroup.value).toBe('Artists')
    expect(dropped).toEqual([])
  })
})
