/**
 * Current team id for collab rooms (#3134). Rooms are namespaced by team, so every
 * connection needs one. Reads crouton-auth's team context when the auth layer is
 * present; returns null otherwise (callers then skip connecting).
 *
 * The value may be a slug — the server resolves id-or-slug and returns the canonical id.
 */
declare const useTeamContext: undefined | (() => { teamId: { value: string | null } })

export function useCollabTeamId(): string | null {
  try {
    if (typeof useTeamContext === 'function') {
      return useTeamContext().teamId.value ?? null
    }
  } catch {
    // Auth layer not installed / no active team
  }
  return null
}
