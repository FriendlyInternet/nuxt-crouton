// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devServer: { port: 3002 },
  modules: [
    '@nuxt/eslint',
    '@nuxt/image',
    '@nuxt/ui',
    '@nuxt/content',
    'nuxt-llms',
    '@nuxtjs/mcp-toolkit'
  ],

  mcp: {
    name: 'Nuxt Crouton MCP Server',
    route: '/mcp'
  },

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  content: {
    build: {
      markdown: {
        toc: {
          searchDepth: 1
        }
      }
    },
    // Production (Cloudflare Workers): content is served from D1, since the
    // Workers runtime can't use a build-time better-sqlite3 file. Local dev keeps
    // SQLite automatically via @nuxt/content's `_localDatabase` default.
    database: {
      type: 'd1',
      bindingName: 'DB'
    }
  },

  // Must be >= 2024-09-19 so nitro selects the MODERN cloudflare_module preset
  // (static assets + deployConfig) instead of cloudflare-module-legacy (Workers
  // Sites), which doesn't emit a deployable wrangler config → "missing entry-point".
  compatibilityDate: '2024-09-19',

  nitro: {
    experimental: { asyncContext: true },
    prerender: {
      routes: ['/'],
      crawlLinks: true
    },
    // Cloudflare Workers deploy (official @nuxt/content path — docs is NOT a NuxtHub
    // app, so nitro itself generates the deploy config via `deployConfig`, declaring
    // the D1 binding `@nuxt/content` queries at runtime). Preset is supplied at build
    // via NITRO_PRESET=cloudflare_module (kept unpinned so `pnpm dev` stays preset-free).
    // id-less D1 → auto-provisions on first deploy; commit the id back here after.
    // https://content.nuxt.com/docs/deploy/cloudflare-workers
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
      wrangler: {
        name: 'docs',
        compatibility_date: '2024-09-19',
        // Staging-slot domain (#133); → docs.friendlyinter.net at the DNS cutover (#134).
        // Auto-bound on deploy (pmcp.dev is a CF zone; token has Zone Workers Routes + DNS Edit).
        routes: [{ pattern: 'docs.friendlyinter.net', custom_domain: true }],
        d1_databases: [{ binding: 'DB', database_name: 'docs-db' }]
      }
    }
  },

  routeRules: {
    '/llms.txt': { prerender: false },
    '/llms-full.txt': { prerender: false },
    '/mcp': { prerender: false },
    '/mcp/**': { prerender: false }
  },

  eslint: {
    config: {
      stylistic: {
        semi: false,
        quotes: 'single',
        indent: 2,
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  icon: {
    provider: 'iconify'
  },

  llms: {
    domain: 'https://nuxt-crouton.dev/',
    title: 'Nuxt Crouton',
    description: 'Generate working CRUD applications in 30 seconds. Built for Nuxt 4 with SuperSaaS opinionated setup.',
    full: {
      title: 'Nuxt Crouton - Complete Documentation',
      description: 'Complete guide to building fast, maintainable CRUD applications with Nuxt Crouton for Nuxt 4.'
    },
    sections: [
      {
        title: 'Getting Started',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/getting-started%' }
        ]
      },
      {
        title: 'Core Concepts',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/core-concepts%' }
        ]
      },
      {
        title: 'Generators',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/generators%' }
        ]
      },
      {
        title: 'Working with Data',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/working-with-data%' }
        ]
      },
      {
        title: 'Customization',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/customization%' }
        ]
      },
      {
        title: 'Advanced',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/advanced%' }
        ]
      },
      {
        title: 'API Reference',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/api-reference%' }
        ]
      },
      {
        title: 'Guides',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/guides%' }
        ]
      }
    ]
  }
})
