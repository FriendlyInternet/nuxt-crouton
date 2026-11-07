/**
 * Nuxt Type Augmentation for @crouton/auth
 *
 * Provides proper typing for useRuntimeConfig() when using @crouton/auth.
 * This ensures the CroutonAuthConfig type is correctly recognized in
 * components, composables, and other code.
 */
import type { CroutonAuthConfig, AuthServerRuntimeConfig } from './config'

declare module 'nuxt/schema' {
  interface PublicRuntimeConfig {
    crouton?: {
      auth?: CroutonAuthConfig
      /** Defined by crouton-email when installed */
      email?: Record<string, unknown>
    }
  }

  interface RuntimeConfig {
    auth?: AuthServerRuntimeConfig
  }
}

// Also augment @nuxt/schema for backwards compatibility
declare module '@nuxt/schema' {
  interface PublicRuntimeConfig {
    crouton?: {
      auth?: CroutonAuthConfig
      /** Defined by crouton-email when installed */
      email?: Record<string, unknown>
    }
  }

  interface RuntimeConfig {
    auth?: AuthServerRuntimeConfig
  }
}

export {}
