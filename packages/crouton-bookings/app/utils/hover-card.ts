/**
 * Open/close timing for ONE shared hover card with no trigger element of its own (#3895).
 *
 * reka's HoverCard only closes on leave/scroll through its trigger, so a trigger-less
 * card (one UPopover positioned by `reference`) would never close by itself. This helper
 * owns that timing instead. Plain TS, no Vue, server-safe: nothing touches a global or
 * starts a timer until a pointer handler runs (and those never run on the server).
 *
 * R1 touch pointers are ignored.
 * R2 entering a trigger opens after `openDelay`; re-entering the open anchor cancels a
 *    pending close, a different anchor does not.
 * R3 leaving a trigger or the card closes after `closeDelay`; entering the card cancels
 *    a pending close; leaving before the open fires cancels the open.
 * R4 close() closes at once and cancels both timers.
 */

export interface HoverCardState<T> {
  open: boolean
  anchor?: Element
  data?: T
}

export interface HoverCardOptions<T> {
  openDelay: number
  closeDelay: number
  onChange: (state: HoverCardState<T>) => void
}

interface PointerLike {
  pointerType?: string
}

type Timer = ReturnType<typeof setTimeout>

export function createHoverCard<T>(options: HoverCardOptions<T>) {
  const { openDelay, closeDelay, onChange } = options
  const state: HoverCardState<T> = { open: false }
  let openTimer: Timer | undefined
  let closeTimer: Timer | undefined

  function set(next: HoverCardState<T>) {
    if (next.open === state.open && next.anchor === state.anchor && next.data === state.data) return
    state.open = next.open
    state.anchor = next.anchor
    state.data = next.data
    onChange({ open: state.open, anchor: state.anchor, data: state.data })
  }

  function clearOpen() {
    if (openTimer !== undefined) clearTimeout(openTimer)
    openTimer = undefined
  }

  function clearClose() {
    if (closeTimer !== undefined) clearTimeout(closeTimer)
    closeTimer = undefined
  }

  function scheduleClose() {
    clearClose()
    closeTimer = setTimeout(() => {
      closeTimer = undefined
      set({ open: false, anchor: state.anchor, data: state.data })
    }, closeDelay)
  }

  const isTouch = (event: PointerLike) => event.pointerType === 'touch'

  return {
    triggerEnter(event: PointerLike, anchor: Element, data: T) {
      if (isTouch(event)) return
      clearOpen()
      if (state.open && anchor === state.anchor) clearClose()
      openTimer = setTimeout(() => {
        openTimer = undefined
        clearClose()
        set({ open: true, anchor, data })
      }, openDelay)
    },
    triggerLeave(event: PointerLike) {
      if (isTouch(event)) return
      clearOpen()
      scheduleClose()
    },
    cardEnter(event: PointerLike) {
      if (isTouch(event)) return
      clearClose()
    },
    cardLeave(event: PointerLike) {
      if (isTouch(event)) return
      scheduleClose()
    },
    close() {
      clearOpen()
      clearClose()
      set({ open: false, anchor: state.anchor, data: state.data })
    }
  }
}
