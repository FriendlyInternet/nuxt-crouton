import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  $meta: {
    name: 'crouton-themes/terminal',
    description: 'Terminal/CRT theme for Nuxt UI — phosphor on black, scanlines, block cursors'
  },
  css: [join(currentDir, 'assets/css/main.css')]
})
