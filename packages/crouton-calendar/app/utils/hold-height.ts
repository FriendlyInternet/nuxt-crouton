/**
 * Hold an element's height while its content redraws (#3813).
 *
 * WebKit (iOS Safari) drops the page's scroll position while Vue redraws the
 * month panels after a month change. Pinning the swipe container's
 * `min-height` across that redraw keeps it. The redraw can land well after the
 * change (~220–276 ms measured in WebKit), so the hold is released only once
 * the watched body has changed AND then stayed quiet for `quietFrames` frames,
 * with a safety timeout in case no redraw ever comes.
 *
 * Pure (no Vue): the DOM pieces come in through `env`, so it unit-tests in node.
 */

export interface HoldEl {
  offsetHeight: number
  style: { minHeight: string }
}

export interface HoldEnv {
  /** Start watching `body`; call `onChange` on every change. Returns a disconnect. */
  observe?: (body: unknown, onChange: () => void) => (() => void) | undefined
  /** Schedule a callback for the next frame. */
  frame?: (cb: () => void) => void
  /** Release anyway after this long. Default 1000. */
  timeoutMs?: number
  /** Frames in a row without a change before release. Default 2. */
  quietFrames?: number
}

export interface Hold {
  /** Resolves once the hold is released. */
  done: Promise<void>
  /** Release now (idempotent). */
  release: () => void
}

function defaultObserve(body: unknown, onChange: () => void) {
  if (!body || typeof MutationObserver === 'undefined') return undefined
  const mo = new MutationObserver(() => onChange())
  mo.observe(body as Node, { childList: true, subtree: true, characterData: true })
  return () => mo.disconnect()
}

function defaultFrame() {
  return typeof requestAnimationFrame === 'function'
    ? (cb: () => void) => { requestAnimationFrame(() => cb()) }
    : undefined
}

// One hold per element: a new hold releases the old one first, so the value
// that gets restored is always the author's original, never a pinned px value.
const active = new WeakMap<object, Hold>()

export function holdHeightUntilRedrawn(
  el: HoldEl | null | undefined,
  body: unknown,
  env: HoldEnv = {},
): Hold {
  if (!el || !el.offsetHeight) return { done: Promise.resolve(), release: () => {} }

  active.get(el)?.release()

  const observe = env.observe ?? defaultObserve
  const frame = env.frame ?? defaultFrame()
  const timeoutMs = env.timeoutMs ?? 1000
  const quietFrames = env.quietFrames ?? 2

  const previous = el.style.minHeight
  el.style.minHeight = `${el.offsetHeight}px`

  let released = false
  let resolveDone!: () => void
  const done = new Promise<void>((r) => { resolveDone = r })
  let disconnect: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let quiet = 0
  let ticking = false

  function release() {
    if (released) return
    released = true
    el!.style.minHeight = previous
    disconnect?.()
    if (timer !== undefined) clearTimeout(timer)
    if (active.get(el!) === hold) active.delete(el!)
    resolveDone()
  }

  function tick() {
    if (released) return
    quiet++
    if (quiet >= quietFrames) {
      ticking = false
      release()
      return
    }
    frame!(tick)
  }

  function onChange() {
    if (released) return
    quiet = 0
    if (!frame || ticking) return
    ticking = true
    frame(tick)
  }

  const hold: Hold = { done, release }
  active.set(el, hold)
  disconnect = observe(body, onChange)
  timer = setTimeout(release, timeoutMs)
  return hold
}

/**
 * Hold the height, then run `change` synchronously (the month change and the
 * track's snap-back belong in one call, so no frame shows the wrong month).
 * Resolves when the hold is released.
 */
export function changeWhileHeld(
  el: HoldEl | null | undefined,
  body: unknown,
  change: () => void,
  env?: HoldEnv,
): Promise<void> {
  const hold = holdHeightUntilRedrawn(el, body, env)
  try {
    change()
  }
  catch (e) {
    hold.release()
    throw e
  }
  return hold.done
}
