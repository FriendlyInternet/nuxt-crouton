import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  $meta: {
    name: 'crouton-themes/gameboy',
    description: 'Game Boy LCD theme for Nuxt UI — the whole UI in 4 shades of olive green'
  },
  css: [join(currentDir, 'assets/css/main.css')]
})
