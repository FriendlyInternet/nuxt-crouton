import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { LocaleObject } from '@nuxtjs/i18n'
import { getCroutonLocales } from '@fyit/crouton-i18n/config-utils'
import { applyPublicRouteOptions } from './app/utils/public-routes'
import { appPageSegments } from './app-page-segments'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Locales are driven by the app's crouton.config.js (same source the
// crouton-i18n layer uses) so this layer never re-adds locales an app turned off.
const croutonLocales = getCroutonLocales()

// Development startup deduplication guard
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-pages')) {
  _dependencies.add('crouton-pages')
}

/**
 * Nuxt Crouton Pages Layer
 *
 * CMS-like page management system with:
 * - Page types from app packages (Bookings, Sales, etc.)
 * - Tree/sortable layout for page ordering
 * - Public page rendering at /[team]/[slug]
 * - Admin page management at /admin/[team]/pages
 * - Custom domain support with automatic team resolution
 */
export default defineNuxtConfig({
  // Extend core crouton and editor, plus the `pages` collection this package
  // owns end to end (#2278): schema, queries, routes, list, composable.
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-editor',
    join(currentDir, 'collections/pages')
  ],

  // Components auto-import with CroutonPages prefix
  components: {
    dirs: [
      {
        path: join(currentDir, 'app/components'),
        prefix: 'CroutonPages',
        global: true
      },
      // Stubs dir: registers AIPageGenerator without prefix so crouton-ai can override it.
      // priority: -1 matches the pattern used by crouton-i18n stubs — overridden by real packages.
      {
        path: join(currentDir, 'app/stubs'),
        prefix: '',
        global: true,
        priority: -1
      }
    ]
  },

  // Auto-import composables
  imports: {
    dirs: [join(currentDir, 'app/composables')]
  },

  // Runtime config schema
  runtimeConfig: {
    public: {
      croutonPages: {
        // App domains that should NOT be treated as custom domains
        // e.g., ['myapp.com', 'staging.myapp.com']
        appDomains: [],
        // Enable debug logging
        debug: false,
        // Redirect old /dashboard/[team] URLs to /[team] (pages-based)
        // Enable this when migrating from dashboard to pages
        redirectDashboard: false,
        // Base URL for absolute SEO URLs (Open Graph, canonical, hreflang)
        // Set via NUXT_PUBLIC_CROUTON_PAGES_SITE_URL env var
        siteUrl: '',
        // Routing mode: how public page URLs are structured
        // 'team'    — /[team]/[locale]/[slug] (multi-tenant, default)
        // 'locale'  — /[locale]/[slug], app provides own routes, root redirects to /{defaultLocale}/
        // 'custom'  — app provides all its own routes, no prefix, no redirect
        routingMode: 'team',
        // Team mode, one-locale apps only: drop the locale from public URLs
        // (/acme/about instead of /acme/en/about). The build fails when the app
        // has more than one locale; ignored (with a warning) outside team mode.
        hideLocaleInUrl: false,
        // Default locale for root redirect in locale mode (/ → /{defaultLocale}/)
        defaultLocale: 'en'
      }
    }
  },

  modules: [
    // In locale/custom mode, remove crouton-pages public page routes so the app
    // can provide its own routes without conflicts. In team mode with
    // hideLocaleInUrl, pin the locale route to the app's one locale.
    function (_options, nuxt) {
      // The app's own top-level addresses (#4175), read from the resolved page
      // tree (every layer's pages + the app's, after pages:extend). The domain
      // resolver leaves these untouched on a connected domain. Evaluated lazily
      // when Nitro loads the module, after the pages are resolved (same two
      // lines @nuxt/kit's addServerTemplate runs).
      nuxt.options.nitro.virtual ||= {}
      nuxt.options.nitro.virtual['#crouton-pages/app-segments'] = () =>
        `export const appPageSegments = ${JSON.stringify(appPageSegments(nuxt.apps.default?.pages || []))}`

      nuxt.hook('pages:extend', (pages) => {
        const pagesConfig = (nuxt.options.runtimeConfig?.public as any)?.croutonPages
        applyPublicRouteOptions(pages, {
          routingMode: pagesConfig?.routingMode || 'team',
          hideLocaleInUrl: pagesConfig?.hideLocaleInUrl === true,
          locales: croutonLocales.map(l => l.code)
        })
      })
    }
  ],

  // Route rules for ISR caching (Nuxt 4.3+)
  // NOTE: Wildcards like '/api/teams/*/pages/**' break layer route matching in Nitro 2.13.1
  // Use specific patterns to avoid conflicts with generated layer routes (/api/teams/[id]/pages-pages/**)
  // ISR caching disabled until we have a safe pattern that doesn't conflict with collection APIs
  // routeRules: {
  //   '/api/teams/*/pages/**': { isr: 3600 }  // BROKEN: conflicts with pages-pages layer routes
  // },

  // Nitro server configuration
  nitro: {
    // Include server middleware and utils
    scanDirs: ['./server'],
    // Mark app-specific aliases as external (they're defined by consuming apps)
    externals: {
      inline: ['#crouton/schema/pages']
    },
    rollupConfig: {
      external: ['#crouton/schema/pages']
    }
  },

  // Vite configuration for build-time
  vite: {
    build: {
      rollupOptions: {
        // Mark as external - these aliases are provided by consuming apps
        external: ['#crouton/schema/pages']
      }
    }
  },

  // i18n translations
  i18n: {
    locales: croutonLocales.map(l => ({ code: l.code, name: l.name, file: l.file })) as LocaleObject[],
    langDir: './locales'
  }
})
