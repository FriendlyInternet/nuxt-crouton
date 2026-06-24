import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

export default defineNuxtConfig({
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-01-19',
  devtools: { enabled: true },
  devServer: { port: 3004 },

  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-layout',
    '@fyit/crouton-flow',
    '@fyit/crouton-editor',
    '@fyit/crouton-ai',
    '@fyit/crouton-mcp-toolkit',
    '@fyit/crouton-email',
    '@fyit/crouton-devtools/eruda',
    // Generated layer must come last
    './layers/thinkgraph'
  ],

  modules: [
    '@fyit/crouton',
    '@nuxtjs/mdc',
  ],

  mdc: {
    highlight: false, // Skip Shiki to keep bundle small
    remarkPlugins: {
      'remark-wiki-links': {
        src: resolve(__dirname, 'app/utils/remark-wiki-links.ts'),
      },
    },
  },

  crouton: {
    mcpToolkit: true,
  },

  croutonAuth: {
    methods: {
      password: true,
      passkeys: false
    }
  },

  runtimeConfig: {
    piWorkerUrl: process.env.PI_WORKER_URL || 'https://pi-api.pmcp.dev', // Pi worker HTTP endpoint
    piDispatchSecret: process.env.PI_DISPATCH_SECRET || '', // Shared secret for authenticating dispatch requests to Pi worker
    webhookSecret: process.env.WEBHOOK_SECRET || '', // Shared secret for Pi worker callbacks
    adminBackfillSecret: '', // NUXT_ADMIN_BACKFILL_SECRET — gates /api/admin/backfill-embeddings
    githubToken: process.env.GITHUB_TOKEN || '', // GitHub PAT for repo watch + changelog sync
    watchReposCronSecret: process.env.WATCH_REPOS_CRON_SECRET || '', // Shared secret for cron-triggered watch runs
    falApiKey: '',      // NUXT_FAL_API_KEY
    geminiApiKey: '',   // NUXT_GEMINI_API_KEY
    email: {
      from: 'hi@messages.friendlyinter.net',
      fromName: 'ThinkGraph',
    },
    public: {
      collabWorkerUrl: process.env.NUXT_PUBLIC_COLLAB_WORKER_URL || '',
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || '',
    },
  },

  hub: {
    db: 'sqlite',
    kv: true
  },

  ogImage: { enabled: false },

  vite: {
    server: {
      allowedHosts: ['.pmcp.dev']
    }
  },

  // Cloudflare Pages deployment
  nitro: {
    alias: {
      '@better-auth/passkey/client': resolve(cfStubs, 'client'),
      '@better-auth/passkey': cfStubs,
      'tsyringe': cfStubs,
      'reflect-metadata': cfStubs,
      '@peculiar/x509': cfStubs,
      '@simplewebauthn/server': cfStubs
    }
  }
})