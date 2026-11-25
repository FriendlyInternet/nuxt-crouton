import { fileURLToPath } from 'node:url'

// Passkey/webauthn stand-ins for Cloudflare Workers (see `nitro.alias` below).
const cfStubs = fileURLToPath(new URL('./server/utils/_cf-stubs', import.meta.url))

export default defineNuxtConfig({
  modules: ['@fyit/crouton-devtools'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-i18n',
    '@fyit/crouton-editor',
    '@fyit/crouton-pages',
    '@fyit/crouton-assets',
    '@fyit/crouton-layout',
    '@fyit/crouton-collab',
    '@fyit/crouton-mcp-toolkit'
  ],

  // Claude edits Kasper's pages live (#4493, the way velo does it): only the
  // page tools, never the generic collection CRUD + token tools. Served at
  // <origin>/mcp (croutonAuth.mcpOAuth is on below); Claude signs in there, no key.
  croutonMcpToolkit: {
    enabled: true,
    genericTools: false,
    pages: true
  },
  hub: {
    db: 'sqlite',
    kv: true,
    blob: true
  },

  // Disable OG Image to reduce bundle size for Cloudflare (saves ~4MB)
  ogImage: { enabled: false },

  // Disable passkeys for Cloudflare Workers (tsyringe incompatibility)
  croutonAuth: {
    methods: {
      passkeys: false
    },
    // One site, one team: `kdm`. It matches `reviewTeam` in deploy.config.json,
    // so every preview deploy seeds this team and attaches the review login to
    // it (scripts/review-team.mjs, scripts/seed-review-login.mjs).
    teams: {
      defaultTeamSlug: 'kdm',
      allowCreate: false,
      showSwitcher: false,
      showManagement: false
    },
    // Claude / ChatGPT sign in to <origin>/mcp (#4493)
    mcpOAuth: true
  },
  // Kasper's site is light only (#4526).
  colorMode: {
    preference: 'light',
    fallback: 'light',
    storageKey: 'kdm-color-mode',
    dataValue: 'light'
  },

  // One-language public site: plain addresses (/about, not /en/about).
  runtimeConfig: {
    public: {
      croutonPages: {
        hideLocaleInUrl: true,
        // kdm.pmcp.dev is the app's own address; kasper.pmcp.dev is the kdm team's connected domain (#4559)
        appDomains: ['kdm.pmcp.dev']
      }
    }
  },

  // Cloudflare Workers deployment — stub passkey/webauthn packages (tsyringe is
  // incompatible with workerd). Preset comes from NITRO_PRESET at build time.
  nitro: {
    alias: {
      '@better-auth/passkey/client': `${cfStubs}/client`,
      '@better-auth/passkey': cfStubs,
      'tsyringe': cfStubs,
      'reflect-metadata': cfStubs,
      '@peculiar/x509': cfStubs,
      '@simplewebauthn/server': cfStubs,
      'papaparse': cfStubs
    }
  }
})
