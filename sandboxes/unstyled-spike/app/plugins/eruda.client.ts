// Mobile in-page devtools for this sandbox preview.
//
// Loads eruda on the client only and auto-inits it, so opening the deployed
// workers.dev URL on a phone shows a devtools panel (the floating button,
// bottom-right) — console (incl. Vue hydration warnings), Elements/DOM, Network
// — with NO bookmarklet, Shortcut, or separate app to trigger. Sandboxes are
// throwaway preview apps, so it's deliberately always-on here (not gated).
export default defineNuxtPlugin(async () => {
  if (!import.meta.client) return
  const eruda = (await import('eruda')).default
  eruda.init()
})
