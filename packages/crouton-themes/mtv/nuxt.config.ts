import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  $meta: {
    name: 'crouton-themes/mtv',
    description: 'Early-MTV theme for Nuxt UI — day-glo blocks, clashing neon shadows, Memphis energy'
  },
  css: [join(currentDir, 'assets/css/main.css')]
})
