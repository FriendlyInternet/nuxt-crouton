import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  $meta: {
    name: 'crouton-themes/braun',
    description: 'Braun/Rams hi-fi theme for Nuxt UI — cream chassis, hairlines, one orange accent'
  },
  css: [join(currentDir, 'assets/css/main.css')],
  components: {
    dirs: [{
      path: join(currentDir, 'components'),
      prefix: 'Braun',
      global: true
    }]
  }
})
