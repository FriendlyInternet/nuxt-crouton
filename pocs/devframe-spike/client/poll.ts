/**
 * Re-run `tick` every `intervalMs` while the dock iframe is visible, so new
 * operations show up without a reload. Stops when the dock closes (the iframe
 * page goes hidden or is unloaded) and refreshes once when it reopens.
 * DevTools 4 exposes no "dock closed" event to an iframe dock, so page
 * visibility is the signal. Returns a stop function.
 */
export function pollWhileVisible(tick: () => unknown, intervalMs = 2000, doc: Document = document, win: Window = window): () => void {
  let timer: ReturnType<typeof setInterval> | undefined
  const run = () => { void Promise.resolve().then(tick).catch(() => {}) }
  const start = () => { if (timer === undefined) timer = setInterval(run, intervalMs) }
  const stop = () => { if (timer !== undefined) { clearInterval(timer); timer = undefined } }
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') stop()
    else if (timer === undefined) { run(); start() }
  }
  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('pagehide', stop)
  if (doc.visibilityState !== 'hidden') start()
  return () => {
    stop()
    doc.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('pagehide', stop)
  }
}
