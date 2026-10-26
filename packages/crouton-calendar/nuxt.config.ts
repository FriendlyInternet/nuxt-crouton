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
  // Note: This is an addon layer - users must explicitly extend:
  // extends: ['@fyit/crouton-core', '@fyit/crouton-calendar']

  $meta: {
    description: 'Swipeable week/month calendar views for Nuxt Crouton',
    name: 'crouton-calendar'
  },

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
  },

  // i18n: translations auto-merge when this layer is extended
  i18n: {
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'nl', name: 'Nederlands', file: 'nl.json' },
      { code: 'fr', name: 'Français', file: 'fr.json' }
    ],
    langDir: '../i18n/locales'
  }
})
