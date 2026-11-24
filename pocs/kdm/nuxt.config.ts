import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@fyit/crouton-devtools'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-i18n',
    '@fyit/crouton-pages',
    '@fyit/crouton-assets',
    '@fyit/crouton-editor',
    '@fyit/crouton-layout'
  ],
  hub: {
    db: 'sqlite',
    kv: true,
    blob: true
  },

  // Kasper's site is light-only — pin the colour mode.
  colorMode: {
    preference: 'light',
    fallback: 'light',
    storageKey: 'kdm-color-mode',
    dataValue: 'light'
  },

  // Disable OG Image to reduce bundle size for Cloudflare (saves ~4MB)
  ogImage: { enabled: false },

  // Disable passkeys for Cloudflare Workers (tsyringe incompatibility)
  croutonAuth: {
    methods: {
      passkeys: false
    },
    // One site, one team: `kdm`. The review login lands in it because
    // deploy.config.json says `"reviewTeam": "kdm"` (#4141) — the two must
    // match, or scripts/review-team.mjs fails the deploy (#4488).
    teams: {
      defaultTeamSlug: 'kdm',
      allowCreate: false,
      showSwitcher: false,
      showManagement: false
    }
  },

  // Cloudflare Workers deployment — stub passkey/webauthn packages (tsyringe is
  // incompatible with workerd). Preset comes from NITRO_PRESET at build time.
  nitro: {
    alias: {
      '@better-auth/passkey/client': resolve(cfStubs, 'client'),
      '@better-auth/passkey': cfStubs,
      'tsyringe': cfStubs,
      'reflect-metadata': cfStubs,
      '@peculiar/x509': cfStubs,
      '@simplewebauthn/server': cfStubs,
      'papaparse': cfStubs
    }
  }
})
