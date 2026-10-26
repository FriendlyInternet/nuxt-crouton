import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Development startup log (deduplicated across layer resolution)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-calendar')) {
  _dependencies.add('crouton-calendar')
  console.log('🍞 crouton:calendar ✓ Layer loaded')
}

export default defineNuxtConfig({
  $meta: {
    description: 'Swipeable week/month calendar layer for Nuxt Crouton',
    name: 'crouton-calendar'
  },

  // Extends crouton-core for collections and team context
  extends: ['@fyit/crouton-core'],

  // Components: prefix 'CroutonCalendar' — distinct from core's date-picker CroutonCalendar
  components: {
    dirs: [
      {
        path: join(currentDir, 'app/components'),
        prefix: 'CroutonCalendar',
        global: true
      }
    ]
  },

  imports: {
    dirs: [join(currentDir, 'app/composables')]
  }
})
