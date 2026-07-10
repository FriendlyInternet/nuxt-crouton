// Mobile in-page devtools for this playground preview (mirrors the retired
// minimal-theme-demo sandbox — see #1306).
//
// Loads eruda on the client only and auto-inits it, so opening the deployed
// workers.dev URL on a phone shows a devtools panel (the floating button,
// bottom-right) — console (incl. Vue hydration warnings), Elements/DOM, Network
// — with NO bookmarklet, Shortcut, or separate app to trigger. The playground is
// a preview/gallery surface, so it's deliberately always-on here (not gated).
export default defineNuxtPlugin(async () => {
  if (!import.meta.client) return
  const eruda = (await import('eruda')).default
  eruda.init()
})
