import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { LocaleObject } from '@nuxtjs/i18n'
import { getCroutonLocales, getCroutonDefaultLocale } from './config-utils'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

const croutonLocales = getCroutonLocales()
const croutonDefaultLocale = getCroutonDefaultLocale()

// Development startup log (deduplicated across layer resolution)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-i18n')) {
  _dependencies.add('crouton-i18n')
  console.log(`🍞 crouton:i18n ✓ Layer loaded (locales: ${croutonLocales.map(l => l.code).join(', ')})`)
}

export default defineNuxtConfig({

  // Expose supported locales to server-side (for locale validation in API endpoints)
  runtimeConfig: {
    croutonI18n: {
      supportedLocales: croutonLocales.map(l => l.code),
      defaultLocale: croutonDefaultLocale,
    },
  },

  // Note: This is an addon layer - users must explicitly extend both:
  // extends: ['@fyit/crouton-core', '@fyit/crouton-i18n']

  // Route rules for SWR caching (Nuxt 4.3+)
  // NOTE: ISR/SWR route rules with wildcards can break routes from extended layers in Nitro 2.13.x
  // The glob patterns interfere with layer route resolution, causing handlers to never execute.
  // See: https://github.com/nuxt/nuxt/issues/33140, https://github.com/nuxt/nuxt/issues/32192
  // Disabled until Nitro fixes layer route + routeRules interaction
  // routeRules: {
  //   '/api/teams/*/settings/translations': { swr: 600 },
  //   '/api/teams/*/translations-ui/**': { swr: 600 }
  // },

  // Add i18n module
  modules: ['@nuxtjs/i18n'],
  $meta: {
    description: 'i18n addon layer for FYIT collections',
    name: 'crouton-i18n'
  },

  // Component configuration
  components: {
    dirs: [
      {
        path: join(currentDir, 'app/components'),
        prefix: 'CroutonI18n',
        global: true
      },
      // Collection form/list for the translationsUi collection: registered as
      // TranslationsUiForm / TranslationsUiList (the canonical <Layer><Plural> names).
      {
        path: join(currentDir, 'app/collection-components'),
        prefix: 'Translations'
      },
      // Stubs dir: registers AITranslateButton without prefix so crouton-ai can override it.
      // priority: -1 matches the pattern used by crouton-core stubs — overridden by real packages.
      // Uses a separate directory to avoid Nuxt deduplicating same-path entries.
      {
        path: join(currentDir, 'app/stubs'),
        prefix: '',
        global: true,
        priority: -1
      }
    ]
  },

  // Composables
  imports: {
    dirs: [join(currentDir, 'app/composables')]
  },

  // i18n configuration — locales driven by crouton.config.js
  i18n: {
    locales: croutonLocales.map(l => ({ code: l.code, name: l.name, file: l.file })) as LocaleObject[],
    langDir: '../locales', // Relative to srcDir (app/)
    defaultLocale: croutonDefaultLocale as any,
    strategy: 'no_prefix', // Team routes handle locale manually: /team/en/page, /team/fr/page
    // Disable automatic redirects - we handle locale in public page routes only
    detectBrowserLanguage: false
  }
})
