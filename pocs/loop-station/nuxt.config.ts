import { execFileSync } from 'node:child_process'

// Loop Station — the WS3 observatory view (#931). A standalone Nuxt app that only
// renders: the committed history.jsonl (WS1) + a collected/example trace.jsonl
// (WS2). It reuses the crouton ecosystem's KO hardware theme (Teenage-Engineering
// inspired) so the observatory reads like a physical instrument — no crouton-core,
// no DB, no auth. The loop graph is Vue Flow + dagre auto-layout.
export default defineNuxtConfig({
  modules: ['@nuxt/ui', 'nuxt-charts'],
  extends: ['@fyit/crouton-themes/ko'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  devServer: { port: 3021 },
  css: [
    '~/assets/css/main.css',
    '@vue-flow/core/dist/style.css',
    '@vue-flow/core/dist/theme-default.css'
  ],
  vite: { optimizeDeps: { include: ['@vue-flow/core', '@dagrejs/dagre'] } },
  // No NuxtHub here, so Nitro writes .output/server/wrangler.json itself (from wrangler.jsonc).
  // The deploy's per-PR preview rewrites that file; without it every preview failed (#2377).
  nitro: { cloudflare: { deployConfig: true, nodeCompat: true } },
  // Stage the observatory data on EVERY build path — the deploy's per-PR preview runs a bare
  // `nuxt build`, which skipped the package.json scripts' prepare step and shipped no data (#2377).
  hooks: {
    'build:before': () => { execFileSync('node', ['scripts/prepare-data.mjs'], { stdio: 'inherit' }) }
  },
  app: {
    head: {
      title: 'Loop Station — Harness Observatory',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }]
    }
  }
})
