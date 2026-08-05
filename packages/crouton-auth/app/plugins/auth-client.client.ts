/**
 * Auth Client Plugin
 *
 * Initializes the Better Auth client on the client-side.
 * Configures organization, passkey, and 2FA client plugins based on @crouton/auth config.
 */
// The Vue client is exported at `better-auth/vue` — NOT `better-auth/client/vue`, which does not
// exist in better-auth 1.5.5 (its exports map has `./vue`, `./client`, `./client/plugins`).
// #1713's body named the wrong subpath; importing it typed the whole client `never`, so every
// `authClient.use*` read failed "not callable" and every consuming app's typecheck/build broke
// while the mocked unit tests stayed green.
import { createAuthClient } from 'better-auth/vue'
import type { BetterAuthClientPlugin } from 'better-auth/client'
import { organizationClient, twoFactorClient, adminClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'
import type { CroutonAuthConfig } from '../../types/config'

// Helper to get auth config with proper typing (used in plugins where composables may not be available)
function getPluginAuthConfig(): CroutonAuthConfig | undefined {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.crouton?.auth as unknown as CroutonAuthConfig | undefined
}

export default defineNuxtPlugin(() => {
  const config = getPluginAuthConfig()

  // Build client plugins based on configuration
  const plugins = buildClientPlugins(config)

  // Create the Better Auth client
  const authClient = createAuthClient({
    baseURL: window.location.origin,
    plugins
  })

  // Log initialization in debug mode
  if (config?.debug) {
    console.log('[@crouton/auth] Client plugin initialized', {
      hasPasskeys: isPasskeyEnabled(config),
      hasTwoFactor: isTwoFactorEnabled(config),
      hasOrganization: true
    })
  }

  // Note: Active organization is fetched by useSession's fetchActiveOrg()
  // which handles the 400 error case by auto-setting an org if needed

  return {
    provide: {
      authClient
    }
  }
})

/**
 * Build array of Better Auth client plugins based on configuration
 */
function buildClientPlugins(config?: CroutonAuthConfig) {
  const plugins: BetterAuthClientPlugin[] = [
    // Organization client is always enabled
    organizationClient(),
    // Admin client for user management (ban, impersonate, etc.)
    adminClient()
  ]

  // Conditionally add passkey client
  if (isPasskeyEnabled(config)) {
    plugins.push(passkeyClient())
  }

  // Conditionally add 2FA client
  if (isTwoFactorEnabled(config)) {
    plugins.push(twoFactorClient())
  }

  return plugins
}

/**
 * Check if passkeys are enabled in the configuration
 */
function isPasskeyEnabled(config?: CroutonAuthConfig): boolean {
  if (!config) return false

  const passkeyConfig = config.methods?.passkeys
  if (passkeyConfig === undefined || passkeyConfig === false) {
    return false
  }
  if (passkeyConfig === true) {
    return true
  }
  return passkeyConfig.enabled !== false
}

/**
 * Check if 2FA is enabled in the configuration
 */
function isTwoFactorEnabled(config?: CroutonAuthConfig): boolean {
  if (!config) return false

  const twoFactorConfig = config.methods?.twoFactor
  if (twoFactorConfig === undefined || twoFactorConfig === false) {
    return false
  }
  if (twoFactorConfig === true) {
    return true
  }
  return twoFactorConfig.enabled !== false
}
