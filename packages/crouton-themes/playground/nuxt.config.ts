// crouton-themes playground (#1306) — the in-package dev surface AND the theme
// gallery used for ui-proposal sign-off on every theme this epic (#1303) touches.
//
// Deliberately private + excluded from the npm publish: the package's `files`
// whitelist (package.json) only ships `themes`/`ko`/`minimal`/`kr11`/`blackandwhite`
// — this directory is never in that list, so it never publishes.
//
// Extends the theme-switching layer (which itself pulls in ko/minimal/kr11) PLUS
// blackandwhite directly, via RELATIVE paths (not the package's own `exports`)
// so editing any theme's `main.css`/`app.config.ts` hot-reloads here immediately —
// no build step, no reinstall, direct Nuxt-layer HMR.
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@vueuse/nuxt'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  devServer: { port: 3031 },

  extends: [
    '../themes',
    '../ko',
    '../minimal',
    '../kr11',
    '../blackandwhite',
    '../brutalist',
    '../mtv',
    '../terminal',
    '../braun',
    '../gameboy'
  ]
})
