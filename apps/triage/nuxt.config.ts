import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

export default defineNuxtConfig({
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-01-19',
  devtools: { enabled: true },
  devServer: { port: 3005 },

  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-layout',
    '@fyit/crouton-ai',
    '@fyit/crouton-editor',
    '@fyit/crouton-pages',
    '@fyit/crouton-triage',
    '@fyit/crouton-charts',
    '@fyit/crouton-flow',
    // Local layers
    './layers/categorize',
    // Generated layers must come last
    './layers/triage',
    './layers/pages'
  ],

  modules: [
    '@fyit/crouton'
  ],

  croutonAuth: {
    methods: {
      password: true,
      passkeys: false
    }
  },

  // Only override what layers can't handle.
  // All other keys come from crouton-core/crouton-triage layers and are
  // populated at runtime via NUXT_* CF Pages secrets.
  runtimeConfig: {
    // Hardcoded: Nitro's env parser truncates this 26-digit number.
    // Not sensitive — visible in every OAuth URL.
    slackClientId: '6917477961058.9867346699728',
    public: {
      baseUrl: process.env.BASE_URL || 'https://triage.friendlyinter.net',
    },
  },

  hub: {
    db: 'sqlite',
    kv: true
  },

  // Disable OG Image to reduce bundle size for Cloudflare
  ogImage: { enabled: false },

  vite: {
    server: {
      allowedHosts: ['.trycloudflare.com', 'triage-dev.pmcp.dev'],
      hmr: {
        protocol: 'wss',
        clientPort: 443,
        host: 'triage-dev.pmcp.dev'
      }
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
