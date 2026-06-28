import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // @fyit/crouton-devtools registers the dev/review launcher — Console (eruda) + Annotate (pin
  // feedback → /api/_review → PR comment). Activated on staging by NUXT_PUBLIC_CROUTON_REVIEW=true
  // (set in cf:staging); zero production footprint. Supersedes the deprecated /eruda extends layer.
  modules: ['@fyit/crouton', '@fyit/crouton-devtools'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  devServer: { port: 3010 },

  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-layout',
    '@fyit/crouton-flow', // L0 Site = the crouton-flow page flow (#site slot)
    '@fyit/crouton-i18n',
    '@fyit/crouton-pages',
    '@fyit/crouton-ai', // optional AI add-on — enables ✨ Magic v2 (gated via hasApp('ai'), #909)
    // Generated collection layers must come last
    './layers/pages'
  ],

  hub: {
    db: 'sqlite',
    kv: true
  },

  // This is a throwaway demo app: it provides its own routes (/, /three), so
  // disable crouton-pages' public page catch-alls to avoid /three being parsed
  // as a team slug. See crouton-pages nuxt.config "routingMode" handling.
  runtimeConfig: {
    // ✨ Magic v2 (#909) — set NUXT_ANTHROPIC_API_KEY to enable the AI tier; absent →
    // the /api/spike-magic-ai route returns `unavailable` and the client degrades to v1.
    anthropicApiKey: '',
    public: {
      croutonPages: {
        routingMode: 'custom'
      }
    }
  },

  // Passkeys are incompatible with Cloudflare Workers (tsyringe) — disable them.
  croutonAuth: {
    methods: {
      passkeys: false
    }
  },

  // Disable OG Image to reduce bundle size for Cloudflare
  ogImage: { enabled: false },

  // Cloudflare Pages deployment — stub passkey/webauthn packages
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
