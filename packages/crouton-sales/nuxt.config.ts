import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { LocaleObject } from '@nuxtjs/i18n'
import { getCroutonLocales, getCroutonDefaultLocale } from '@fyit/crouton-i18n/config-utils'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Locales are driven by the app's crouton.config.js (same source the
// crouton-i18n layer uses) so this layer never re-adds locales an app turned off.
const croutonLocales = getCroutonLocales()
const croutonDefaultLocale = getCroutonDefaultLocale()

// Development startup log (deduplicated across layer resolution)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-sales')) {
  _dependencies.add('crouton-sales')
  console.log('🍞 crouton:sales ✓ Layer loaded')
}

export default defineNuxtConfig({
  // Usage:
  // extends: ['@fyit/crouton-core', '@fyit/crouton-sales']

  // Sales prints through the generic crouton-printing queue (epic #325): it
  // provides the print_jobs/printers tables, the enqueue/lifecycle API, and the
  // ESC/POS engine + transport that sales used to ship itself.
  // The 11 sales collections (schema, queries, routes, list, composable) ship
  // with the package (#2278). Table names, API paths and registry keys stay
  // byte-identical to what apps used to generate: deployed D1s depend on them.
  extends: [
    '@fyit/crouton-printing',
    join(currentDir, 'collections/events'),
    join(currentDir, 'collections/products'),
    join(currentDir, 'collections/categories'),
    join(currentDir, 'collections/orders'),
    join(currentDir, 'collections/orderitems'),
    join(currentDir, 'collections/locations'),
    join(currentDir, 'collections/clients'),
    join(currentDir, 'collections/eventsettings'),
    join(currentDir, 'collections/printers'),
    join(currentDir, 'collections/printqueues'),
    join(currentDir, 'collections/kdsbumps')
  ],

  modules: ['@nuxtjs/i18n'],

  $meta: {
    description: 'POS/Sales system for Nuxt Crouton - products, categories, orders, and optional thermal receipt printing',
    name: 'crouton-sales'
  },

  // Component configuration
  components: {
    dirs: [
      {
        path: join(currentDir, 'app/components'),
        prefix: 'Sales',
        global: true
      }
    ]
  },

  // Composables auto-import
  imports: {
    dirs: [join(currentDir, 'app/composables')]
  },

  // Kassa viewport meta (safe-area + input-zoom suppression) lives in
  // app/plugins/viewport-meta.ts — a layer's app.head can't override Nuxt's
  // default viewport meta, so it's applied at runtime via useHead.

  // i18n configuration
  i18n: {
    locales: croutonLocales.map(l => ({ code: l.code, name: l.name, file: l.file })) as LocaleObject[],
    langDir: '../i18n/locales',
    defaultLocale: croutonDefaultLocale as any,
    strategy: 'no_prefix'
  }
})
