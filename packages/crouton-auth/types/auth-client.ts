/**
 * Auth Client Type Definitions
 *
 * Provides properly typed auth client with all plugin methods.
 * Better Auth's client is dynamically typed based on plugins,
 * so we create a comprehensive type that covers all configured plugins.
 */
import { createAuthClient } from 'better-auth/client'
import {
  organizationClient,
  twoFactorClient,
  magicLinkClient,
  adminClient
} from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'

/**
 * Create a fully-typed auth client with all plugins
 * This is used for type inference only
 */
const _typedAuthClient = createAuthClient({
  plugins: [
    organizationClient(),
    passkeyClient(),
    twoFactorClient(),
    magicLinkClient(),
    adminClient()
  ]
})

/**
 * Full auth client type with all possible plugins
 *
 * This type includes all plugin methods regardless of config
 * to provide complete type safety. At runtime, some methods
 * may not be available depending on configuration.
 */
export type CroutonAuthClient = typeof _typedAuthClient

/**
 * Helper to get auth client with proper typing
 * Returns the typed auth client. Will throw on server-side if accessed.
 */
export function useAuthClient(): CroutonAuthClient {
  const nuxtApp = useNuxtApp()
  return nuxtApp.$authClient as CroutonAuthClient
}

/**
 * Helper to get auth client with proper typing (nullable)
 * Returns null on server-side since authClient is client-only
 */
export function useAuthClientSafe(): CroutonAuthClient | null {
  const nuxtApp = useNuxtApp()
  return (nuxtApp.$authClient ?? null) as CroutonAuthClient | null
}

// Module augmentation for NuxtApp is defined in the generated .nuxt/types/*.d.ts files
// when the module is properly installed. We don't define it here to avoid
// "Cannot find module '#app'" errors during standalone package typechecking.

declare module 'vue' {
  interface ComponentCustomProperties {
    $authClient: CroutonAuthClient
  }
}
