/**
 * Local type augmentation for the crouton:operation Nitro hook.
 *
 * The canonical declaration lives in @fyit/crouton (crouton-hooks.d.ts).
 * This file ensures the hook is recognised during standalone type-checking
 * of the crouton-triage package.
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
  }
}

export {}
