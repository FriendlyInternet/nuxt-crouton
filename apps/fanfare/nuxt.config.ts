import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

// The Workers stubs only apply to the Cloudflare build (cloudflare-pages OR the
// cloudflare_module Workers preset). On the node-server target (venue/Pi) we keep
// the real deps so passkeys etc. work.
const preset = process.env.NITRO_PRESET ?? 'cloudflare-pages'
const isCloudflare = preset.startsWith('cloudflare')

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@fyit/crouton'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  devServer: { port: 3007 },
  extends: [
    '@fyit/crouton-core',
    // Email sender (Resend) — provides the crouton:auth:email listener that
    // actually delivers team invites / verification mail. Without this layer the
    // hook fires and gets logged, but nothing sends (fanfare had no sender at
    // all before this). API key comes from the NUXT_EMAIL_RESEND_API_KEY worker
    // secret; from/brand are configured below.
    '@fyit/crouton-email',
    '@fyit/crouton-layout',
    '@fyit/crouton-i18n',
    '@fyit/crouton-charts',
    '@fyit/crouton-pages',
    '@fyit/crouton-printing',
    '@fyit/crouton-sales',
    // Base themes layer: ships the runtime switcher (useThemeSwitcher +
    // themeProvider plugin), which populates the pill's theme quick-select and
    // the CV-menu Theme submenu. The preset layers below are CSS/variants only.
    // (It also re-pulls ko/minimal/kr11, which dedupe against the entries below.)
    '@fyit/crouton-themes/themes',
    // Theme layers under test (#1303/#1332): the team Look-and-Feel presets
    // inject ko-*/bw-* classes at runtime, but without these layers the CSS
    // behind those classes never ships — presets were palette-only before.
    '@fyit/crouton-themes/ko',
    '@fyit/crouton-themes/blackandwhite',
    '@fyit/crouton-themes/minimal',
    '@fyit/crouton-themes/kr11',
    '@fyit/crouton-themes/brutalist',
    '@fyit/crouton-themes/mtv',
    '@fyit/crouton-themes/terminal',
    '@fyit/crouton-themes/braun',
    '@fyit/crouton-themes/gameboy',
    '@fyit/crouton-themes/riso',
    '@fyit/crouton-themes/eink',
    '@fyit/crouton-themes/blueprint',
    './layers/sales',
    './layers/pages'
  ],
  appConfig: {
    croutonApps: {
      sales: {
        landingRoute: {
          path: '/sales/events',
          label: 'sales.title',
          icon: 'i-lucide-shopping-cart'
        }
      }
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
    // No public landing page — '/' bounces signed-out users back to login,
    // so the auth modal's "Go home" button would strand them on a spinner.
    ui: {
      showGoHome: false
    }
  },

  // Runtime config:
  // - printApiKey: shared key the polling spooler uses
  // - print.enabled: gate that controls whether order POST enqueues print jobs
  // - cloudSyncSecret: shared secret the Pi pusher (#177) presents to the cloud
  //   D1 ingest (#178). Empty by default = fail-closed (ingest rejects all).
  // Override via NUXT_CROUTON_SALES_PRINT_API_KEY / NUXT_CROUTON_SALES_PRINT_ENABLED /
  // NUXT_CROUTON_SALES_CLOUD_SYNC_SECRET.
  runtimeConfig: {
    croutonSales: {
      printApiKey: '1234',
      cloudSyncSecret: '',
      print: { enabled: true }
    },
    // Transactional email (crouton-email → Resend). The API key is injected at
    // runtime from the NUXT_EMAIL_RESEND_API_KEY worker secret; the sender is a
    // verified Resend domain (messages.friendlyinter.net).
    email: {
      from: 'noreply@messages.friendlyinter.net',
      fromName: 'Fanfare'
    }
  },

  // Cloudflare Workers deployment — the preset is supplied at build time via
  // NITRO_PRESET (cloudflare_module in cf:deploy/cf:preview; node-server for the
  // Pi target). Not pinned here so the same config serves both targets.
  nitro: {
    sourceMap: false,
    alias: isCloudflare
      ? {
          '@better-auth/passkey/client': resolve(cfStubs, 'client'),
          '@better-auth/passkey': cfStubs,
          'tsyringe': cfStubs,
          'reflect-metadata': cfStubs,
          '@peculiar/x509': cfStubs,
          '@simplewebauthn/server': cfStubs,
          'papaparse': cfStubs
        }
      : {},
    // node-server (venue/Pi) target: Nitro's externalizer mangles drizzle-orm in
    // this pnpm monorepo — it misses the `drizzle-orm/libsql` driver subpath and
    // emits broken absolute pnpm-store paths for drizzle's internal cross-imports,
    // so `node .output/server` dies with ERR_MODULE_NOT_FOUND. Inline the whole of
    // drizzle-orm so Rollup bundles it self-contained into the server chunk (only
    // the imported subpaths — core + libsql — are pulled in; the unused mysql/pg
    // drivers are not). @libsql/client stays external and traces fine. The
    // Cloudflare build uses D1 (no libsql) so it's scoped out by isCloudflare. (#798)
    externals: isCloudflare ? {} : { inline: ['drizzle-orm'] }
  }
})