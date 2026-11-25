import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Editorial theme (#4520) — book-style serif on white, sans controls, pill buttons.
//
// Fonts: free OFL stand-ins only (never GT America / Iowan). They come through
// @nuxt/fonts (installed by Nuxt UI 4): downloaded at BUILD time and served
// from the app's own /_fonts/, so no third-party request happens at runtime.
// If a download fails the CSS stacks fall back to Georgia / system-ui.
export default defineNuxtConfig({
  $meta: {
    name: 'nuxt-crouton-themes/editorial',
    description: 'editorial theme for Nuxt UI'
  },
  css: [join(currentDir, 'assets/css/main.css')],
  fonts: {
    families: [
      { name: 'Source Serif 4', provider: 'google', global: true, weights: [400, 600], styles: ['normal', 'italic'] },
      { name: 'Inter', provider: 'google', global: true, weights: [400, 500] },
      { name: 'JetBrains Mono', provider: 'google', global: true, weights: [400] },
      { name: 'Chakra Petch', provider: 'google', global: true, weights: [500] }
    ]
  }
})
