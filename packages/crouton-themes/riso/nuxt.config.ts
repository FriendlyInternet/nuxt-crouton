import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  $meta: {
    name: 'crouton-themes/riso',
    description: 'riso theme for Nuxt UI'
  },
  css: [join(currentDir, 'assets/css/main.css')]
})
