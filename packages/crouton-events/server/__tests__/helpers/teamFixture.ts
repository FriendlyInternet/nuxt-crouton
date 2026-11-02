import { vi } from 'vitest'

/**
 * Drives the REAL requireTeamAdmin / resolveTeamAndCheckMembership: only the modules team.ts
 * imports (`#imports`, useServerAuth) and the global `useDB` are faked. The fake DB answers the
 * organization lookup and the member lookup for the team in the request path.
 */
export const fixture = {
  pathTeam: 'team-a',
  user: { id: 'u1', name: 'Una', email: 'una@x.io' } as any,
  /** teamId -> role of the session user */
  roles: {} as Record<string, string>
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
