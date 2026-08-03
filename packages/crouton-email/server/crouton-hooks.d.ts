/**
 * Augment NitroRuntimeHooks with crouton:operation for standalone typecheck.
 *
 * The canonical declaration lives in crouton-core/crouton-hooks.d.ts.
 * This file makes the hook type available when typechecking crouton-email
 * in isolation (i.e. without crouton-core loaded as a Nuxt layer), because
 * tsconfig.server.json includes `../server/**\/*` but not the package types/.
 */
declare module 'nitropack' {
  interface NitroRuntimeHooks {
    'crouton:operation': (payload: {
      type: string
      source: string
      teamId?: string
      userId?: string
      correlationId?: string
      metadata?: Record<string, any>
      timestamp?: number
    }) => void | Promise<void>

    'crouton:auth:email': (payload: CroutonAuthEmailPayload) => void | Promise<void>

    'crouton:auth:email:result': (payload: CroutonAuthEmailResultPayload) => void | Promise<void>
  }
}

/**
 * Result of an actual send attempt, emitted back to crouton-auth's email logger
 * so it can flip the `pending` row to `sent` / `failed` (issue #1542).
 */
export interface CroutonAuthEmailResultPayload {
  to: string
  type: 'verification' | 'password-reset' | 'invitation' | 'magic-link'
  ok: boolean
  error?: string
}

export type CroutonAuthEmailPayload = {
  /** H3 event for Cloudflare Workers runtime config access. Optional for backwards compat. */
  _event?: import('h3').H3Event
} & (
  | { type: 'verification', to: string, url: string, userName?: string }
  | { type: 'password-reset', to: string, url: string, userName?: string }
  | { type: 'invitation', to: string, invitationId: string, organizationName: string, inviterName: string, inviterEmail: string, role: string, expiresAt: Date }
  | { type: 'magic-link', to: string, url: string }
)

export {}
