/**
 * Stand-in for crouton-auth's `can()` / `requireCan()` (#4108).
 *
 * Mirrors what the real `can()` answers with no site config (#4104): owner and
 * admin may every action, member none. `grants` lets a test hand a role extra
 * actions, the way a site's `teams.roles` would. The real `can()` is proven by
 * crouton-auth's `permissions.test.ts` and `route-actions.test.ts`.
 */
export type Grants = Record<string, '*' | string[]>

export const DEFAULT_GRANTS: Grants = { owner: '*', admin: '*', member: [] }

function roleCan(role: string | undefined, action: string, grants: Grants = DEFAULT_GRANTS): boolean {
  const granted = role ? grants[role] : undefined
  return granted === '*' || (Array.isArray(granted) && granted.includes(action))
}

/**
 * A `team-auth` module whose `requireCan` resolves the context with `resolve`
 * and refuses (403) unless the context's role may do the action. `asked`
 * records every action asked, so a test can check the route asked the right one.
 */
export function teamAuthStub<C extends { membership?: { role?: string } }>(resolve: () => Promise<C> | C, grants: () => Grants = () => DEFAULT_GRANTS) {
  const asked: string[] = []
  const roleOf = async () => (await resolve()).membership?.role
  return {
    asked,
    module: {
      can: async (_teamId: string, _userId: string, action: string) => {
        asked.push(action)
        return roleCan(await roleOf(), action, grants())
      },
      requireCan: async (_event: unknown, action: string) => {
        asked.push(action)
        const ctx = await resolve()
        if (!roleCan(ctx.membership?.role, action, grants())) {
          throw Object.assign(new Error(`Not allowed: ${action}`), { status: 403, statusCode: 403 })
        }
        return ctx
      }
    }
  }
}
