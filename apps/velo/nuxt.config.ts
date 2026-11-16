import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // crouton-devtools is what INSTALLS the review overlay (it gates + installs
  // @fyit/crouton-feedback). Without it, `NUXT_PUBLIC_CROUTON_REVIEW=true` sets a
  // flag no module reads and a "review preview" serves nothing to pin a comment on
  // (#2073). In a production build the module gates itself off entirely — it
  // returns before installing anything unless dev / the devtools flag / the review
  // flag is set — so this costs a normal deploy nothing.
  modules: ['@fyit/crouton-devtools'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  devServer: { port: 3006 },
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-i18n',
    '@fyit/crouton-assets',
    '@fyit/crouton-pages',
    '@fyit/crouton-bookings',
    '@fyit/crouton-email',
    '@fyit/crouton-maps',
    '@fyit/crouton-events',
    '@fyit/crouton-collab',
    // Statistics: bookings registers chart presets when charts is present (admin-only data)
    '@fyit/crouton-charts',
  ],
  hub: {
    blob: true,
    db: 'sqlite'
  },

  // Disable OG Image to reduce bundle size for Cloudflare (saves ~4MB)
  ogImage: { enabled: false },
  // og:site_name + schema-org site name — Site Config v4 no longer infers it
  site: { name: 'Velotheek' },

  // Enable booking email notifications
  runtimeConfig: {
    email: {
      from: 'noreply@messages.friendlyinter.net',
      fromName: 'Friendly Internet'
    },
    croutonBookings: {
      email: { enabled: true }
    },
    public: {
      crouton: {
        email: {
          brand: {
            name: 'Velotheek',
            primaryColor: '#0F766E',
            // Production default. Staging overrides it at runtime with the Worker var
            // NUXT_PUBLIC_CROUTON_EMAIL_BRAND_URL (wrangler.jsonc → env.staging.vars), so
            // a booking email sent from velo.pmcp.dev links back to staging (#2405).
            url: 'https://velo.friendlyinter.net'
          }
        }
      } as any,
      croutonBookings: {
        email: { enabled: true }
      }
    }
  },

  // Disable passkeys for Cloudflare Workers (tsyringe incompatibility)
  croutonAuth: {
    appName: 'Velo',
    // Invite-only: only people with a pending invitation can create an account (#3340)
    signup: 'invite',
    // Only the site admin creates books (teams); everyone else joins by invite
    teams: { allowCreate: 'superAdmin' },
    methods: {
      passkeys: false
    }
  },

  routeRules: {
    // Static assets — immutable cache (hashed filenames)
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },

    // NOTE: Do NOT add wildcard SWR rules on team API routes here — neither
    // '/api/teams/*/…' nor '/api/crouton-bookings/teams/*/…'. The wildcard
    // conflicts with radix3's :id parameter routing and 404s the deeper routes:
    // '/api/crouton-bookings/teams/*/availability' (added 2026-03-05, 0c7dad560)
    // broke editing a booking, resend-email and the chart endpoints (#3928).

    // Auth pages — prerender (static, no data) + no caching fallback
    '/auth/login': { prerender: true },
    '/auth/register': { prerender: true },
    '/auth/forgot-password': { prerender: true },
    '/auth/**': { headers: { 'cache-control': 'no-store' } },

    // Admin — no caching (personalized)
    '/admin/**': { headers: { 'cache-control': 'no-store' } },
  },

  // Cloudflare Workers deployment — preset supplied at build via NITRO_PRESET
  // (cf:deploy/cf:staging); intentionally NOT pinned here so dev/build stay preset-free.
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