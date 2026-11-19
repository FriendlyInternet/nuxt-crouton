// https://nuxt.com/docs/api/configuration/nuxt-config
//
// MCP sign-in e2e fixture (#4096): crouton-auth as the OAuth provider for MCP
// apps, next to crouton-mcp-toolkit (whose own `/.well-known/*` 404 handlers
// must not win when the flag is on). The flag comes from the env so the same
// app can be booted both ways: on by default, `CROUTON_MCP_OAUTH=0` for the
// flag-off checks (e2e/mcp-oauth.smoke.spec.ts boots that one itself, with its
// own build dir so the two dev servers don't share `.nuxt`).
const mcpOAuth = process.env.CROUTON_MCP_OAUTH !== '0'

export default defineNuxtConfig({
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  extends: ['@fyit/crouton-core', '@fyit/crouton-layout', '@fyit/crouton-i18n', '@fyit/crouton-mcp-toolkit'],
  ...(process.env.E2E_BUILD_DIR ? { buildDir: process.env.E2E_BUILD_DIR } : {}),
  hub: {
    db: 'sqlite',
    kv: true
  },

  // Disable OG Image to reduce bundle size for Cloudflare (saves ~4MB)
  ogImage: { enabled: false },

  croutonMcpToolkit: {
    enabled: true
  },

  // Disable passkeys for Cloudflare Workers (tsyringe incompatibility)
  croutonAuth: {
    mcpOAuth,
    methods: {
      passkeys: false
    }
  }
})
