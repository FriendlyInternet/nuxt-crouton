import { vi } from 'vitest'

/**
 * Drives the REAL resolveTeamAndCheckMembership (and, through teamAuthModule, requireCan's team check): only the modules team.ts
 * imports (`#imports`, useServerAuth) and the global `useDB` are faked. The fake DB answers the
 * organization lookup and the member lookup for the team in the request path.
 */
export const fixture = {
  pathTeam: 'team-a',
  user: { id: 'u1', name: 'Una', email: 'una@x.io' } as any,
  /** teamId -> role of the session user */
  roles: {} as Record<string, string>,
  /** role -> actions it may do; owner/admin every action, member none (the no-config default, #4104) */
  grants: { owner: '*', admin: '*', member: [] } as Record<string, '*' | string[]>,
  /** every action a route asked requireCan / can for (#4108) */
  asked: [] as string[]
}

const roleCan = (role: string | undefined, action: string) => {
  const granted = role ? fixture.grants[role] : undefined
  return granted === '*' || (Array.isArray(granted) && granted.includes(action))
}

/**
 * Stand-in for `@fyit/crouton-auth/server/utils/team-auth` (#4108). `requireCan` runs the REAL
 * resolveTeamAndCheckMembership (so "admin of another team" is still refused by the real
 * membership read), then answers the action from `fixture.grants` the way the real `can()`
 * answers from the site's roles. The real `can()` is proven in crouton-auth's tests.
 * Use: inside `vi.mock('@fyit/crouton-auth/server/utils/team-auth', async () => …)`, destructure
 * `teamAuthModule` from a dynamic import of this file and return `teamAuthModule()`.
 */
export async function teamAuthModule() {
  const team = await import('@fyit/crouton-auth/server/utils/team')
  return {
    ...team,
    can: async (teamId: string, userId: string, action: string) => {
      fixture.asked.push(action)
      const membership = await team.getOrganizationMembershipDirect(teamId, userId)
      return roleCan(membership?.role, action)
    },
    requireCan: async (event: any, action: string) => {
      fixture.asked.push(action)
      const ctx = await team.resolveTeamAndCheckMembership(event)
      if (!roleCan(ctx.membership?.role, action)) {
        throw Object.assign(new Error(`Not allowed: ${action}`), { status: 403, statusCode: 403 })
      }
      return ctx
    }
  }
}

export function installTeamFixture() {
  const db = {
    select: () => ({
      from: (table: any) => ({
        where: () => ({
          limit: async () => {
            const isMember = table?.userId !== undefined && table?.organizationId !== undefined
            if (isMember) {
              const role = fixture.roles[fixture.pathTeam]
              return role ? [{ id: 'm1', organizationId: fixture.pathTeam, userId: fixture.user.id, role, createdAt: new Date() }] : []
            }
            return [{ id: fixture.pathTeam, name: 'T', slug: fixture.pathTeam, createdAt: new Date() }]
          }
        })
      })
    })
  }
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('createError', (o: any) => Object.assign(new Error(o.statusText ?? o.message), o))
  return db
}

export const fakeEvent = () => ({ context: { params: { id: fixture.pathTeam } } }) as any
