import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // The builder is a signed-in editing tool: the server can't know the page being
  // edited, so a server render showed an empty board with disabled buttons that the
  // browser sometimes never re-enabled (#2598). Render it in the browser only.
  routeRules: { '/builder/**': { ssr: false } },
  modules: ['@fyit/crouton-devtools'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // crouton-flow (Site level) rides Vue Flow; extended here (not default-on).
  // crouton-flow pulls in crouton-collab; live sync stays off because this app doesn't opt in (no "collab": true, #3810).
  // crouton-bookings (#2559): its atomic layout blocks (calendar / filters / locations /
  // list) join the block row, the same package booking-demo extends.
  extends: ['@fyit/crouton-core', '@fyit/crouton-layout', '@fyit/crouton-flow', '@fyit/crouton-i18n', '@fyit/crouton-bookings', './layers/builder'],

  // View Transitions API — the graduated Page⇄Site morph (Replace: page-site-transition).
  // Matching `view-transition-name` on the flow card + the board makes the card grow
  // into the board and shrink back; replaces the POC's cross-fade stopgap.
  experimental: {
    viewTransition: true
  },

  // Surface the spec-derived graduation plan IN-APP as a @fyit/crouton-feedback
  // "Plan" tool (a badged launcher row, like the Changelog tool) — so the
  // human-in-the-loop reads it on the running preview. Data-first: it renders
  // graduation-plan.json (joined with the spec ledger it points at via
  // `specSource`) natively with Nuxt UI; the badge is the active phase.
  croutonFeedback: {
    plan: {
      dataPath: 'graduation-plan.json'
    }
  },
  hub: {
    db: 'sqlite',
    kv: true
  },

  // Disable OG Image to reduce bundle size for Cloudflare (saves ~4MB)
  ogImage: { enabled: false },

  // Disable passkeys for Cloudflare Workers (tsyringe incompatibility)
  croutonAuth: {
    methods: {
      passkeys: false
    },
    // /builder is a root route (no [team] param), so team context comes entirely from the
    // session's active org. No `autoCreateOnSignup` (#2559): with it, every new session is
    // pointed at the user's personal workspace first (crouton-auth session-org.ts), so the
    // review login never lands in the seeded team `test1` and the bookings blocks show no
    // data. A user with a membership lands in that team; a fresh user with zero orgs gets a
    // personal workspace from the ensure-team.client plugin instead.
    teams: {}
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