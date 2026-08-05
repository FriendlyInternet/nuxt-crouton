import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  $meta: {
    name: 'crouton-themes/brutalist',
    description: 'Brutalist theme for Nuxt UI — thick borders, hard shadows, zero subtlety'
  },
  css: [join(currentDir, 'assets/css/main.css')]
})
