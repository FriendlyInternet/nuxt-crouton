/**
 * Auth Client Type Definitions
 *
 * Provides properly typed auth client with all plugin methods.
 * Better Auth's client is dynamically typed based on plugins,
 * so we create a comprehensive type that covers all configured plugins.
 */
// Derive the type from the SAME client the runtime plugin builds — `better-auth/vue`
// (#1738). Deriving it from `better-auth/client` (vanilla) declared `use*` as nanostore
// ATOMS while `auth-client.client.ts` created the Vue client, whose `use*` are FUNCTIONS
// returning `DeepReadonly<Ref<…>>`. That mismatch is what made `useTeam.ts` "not callable"
// (TS2349) and every `as CroutonAuthClient` cast stop overlapping (TS2352).
import { createAuthClient } from 'better-auth/vue'
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
 * Get the auth client, or `null` when it isn't available.
 *
 * `auth-client.client.ts` is a CLIENT-ONLY plugin, so `$authClient` is
 * `undefined` during SSR — hence the nullable return. This used to be typed
 * non-nullable, which meant TypeScript could not flag an unguarded dereference
 * and a 500-on-every-server-rendered-page shipped with a green typecheck (#1951,
 * incident in #1738/#1884). Safe to call at setup; guard before you dereference.
 *
 * Inside a code path that only ever runs client-side (an event handler,
 * `onMounted`), prefer `requireAuthClient()` — it is non-nullable and fails loudly.
 */
export function useAuthClient(): CroutonAuthClient | null {
  const nuxtApp = useNuxtApp()
  return (nuxtApp.$authClient ?? null) as CroutonAuthClient | null
}

/**
 * Get the auth client, throwing if it is unavailable.
 *
 * For CLIENT-ONLY code paths that genuinely cannot proceed without it. Call it
 * INSIDE the handler, never at composable setup — setup runs during SSR, where
 * this throws by design.
 */
export function requireAuthClient(): CroutonAuthClient {
  const client = useAuthClient()
  if (!client) {
    throw new Error(
      '[crouton-auth] auth client unavailable — it is client-only, so this ran during SSR. '
      + 'Call requireAuthClient() inside a client-only path, or use useAuthClient() and guard the null.'
    )
  }
  return client
}

/**
 * @deprecated Redundant since `useAuthClient()` became honestly nullable (#1951).
 * Use `useAuthClient()`; this is kept as an alias so existing call sites keep working.
 */
export function useAuthClientSafe(): CroutonAuthClient | null {
  return useAuthClient()
}

// Module augmentation for NuxtApp is defined in the generated .nuxt/types/*.d.ts files
// when the module is properly installed. We don't define it here to avoid
// "Cannot find module '#app'" errors during standalone package typechecking.

declare module 'vue' {
  interface ComponentCustomProperties {
    $authClient: CroutonAuthClient
  }
}
