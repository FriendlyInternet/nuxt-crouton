/**
 * Local type augmentation for the crouton:operation Nitro hook.
 *
 * The canonical declaration lives in @fyit/crouton (crouton-hooks.d.ts).
 * This file ensures the hook is recognised during standalone type-checking
 * of the crouton-auth package, which does not depend on @fyit/crouton directly.
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

    'crouton:scoped-access:before-redeem': (payload: ScopedAccessBeforeRedeemPayload) => void | Promise<void>
  }
}

/**
 * Payload for the crouton:scoped-access:before-redeem Nitro hook.
 *
 * Fired by the generic redeem endpoint before verifyAndRedeemGrant so domain
 * packages can lazily sync their source credential into the grant (e.g.
 * crouton-sales syncs salesEvents.helperPin into the event grant). Handlers
 * must trim synced secrets and pass skipWhenLocked to upsertScopedGrant.
 * The presented secret is deliberately NOT in the payload.
 */
export interface ScopedAccessBeforeRedeemPayload {
  organizationId: string
  resourceType: string
  resourceId: string
  credentialType: string
}

/**
 * Payload for the crouton:auth:email:result Nitro hook.
 *
 * Emitted by the email sender (crouton-email) AFTER an actual send attempt, so
 * the crouton-auth email logger can update the row it logged as `pending` to
 * the true outcome (`sent` / `failed`). When no sender is installed the hook
 * never fires and the row stays `pending` — an honest "never confirmed" signal
 * rather than a false `sent`.
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
