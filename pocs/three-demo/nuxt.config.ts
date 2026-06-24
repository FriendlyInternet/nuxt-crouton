import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@fyit/crouton'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  devServer: { port: 3008 },

  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-layout',
    '@fyit/crouton-i18n',
    '@fyit/crouton-three',
    '@fyit/crouton-pages',
    '@fyit/crouton-devtools/eruda',
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
