import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { H3Event } from 'h3'
import type { Team, Member } from '../../../types'

// Import after mocks are set up
import {
  resolveTeamAndCheckMembership,
  getMembership,
  getTeamById,
  getTeamBySlug,
  getUserTeams,
  canUserCreateTeam,
  requireTeamRole,
  requireTeamAdmin,
  requireTeamOwner,
  canEditPages,
  getUserTeamsDirect
} from '../../../server/utils/team'

// Mock H3Event
const createMockEvent = (overrides = {}): H3Event => ({
  node: { req: {}, res: {} },
  headers: new Headers({ cookie: 'session-token=test' }),
  context: {},
  ...overrides
}) as unknown as H3Event

// Mock session response
const createMockSessionResponse = (activeOrgId = 'team-1') => ({
  user: {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    image: null,
    emailVerified: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  },
  session: {
    id: 'session-1',
    userId: 'user-1',
    activeOrganizationId: activeOrgId,
    expiresAt: '2025-01-01T00:00:00.000Z'
  }
})

// Mock Better Auth API
const mockAuthApi = {
  getSession: vi.fn(),
  listMembers: vi.fn(),
  getFullOrganization: vi.fn(),
  listOrganizations: vi.fn(),
  createOrganization: vi.fn(),
  setActiveOrganization: vi.fn()
}

// Mock auth instance
const mockAuthInstance = {
  api: mockAuthApi
}

// Mock runtime config - can be overridden per test
let mockConfig = {
  public: {
    crouton: {
      auth: {
        mode: 'multi-tenant' as const,
        defaultTeamId: 'default',
        appName: 'Test App',
        teams: {
          allowCreate: true,
          limit: 5
        }
      }
    }
  }
}

// Setup global mocks
vi.stubGlobal('useRuntimeConfig', () => mockConfig)

vi.stubGlobal('createError', (options: { statusCode: number, message: string }) => {
  const error = new Error(options.message) as Error & { statusCode: number }
  error.statusCode = options.statusCode
  return error
})

vi.stubGlobal('getRouterParam', vi.fn((_event: H3Event, param: string) => {
  if (param === 'id') return 'team-1'
  return null
}))

// Mock hubDatabase for D1
vi.stubGlobal('hubDatabase', () => ({}))

// Import schema tables for reference comparison in useDB mock
import { organization, member as memberTableSchema } from '../../../server/database/schema/auth'

// Configurable mock results for Drizzle queries
let mockOrgRows: any[] = []
let mockMemberRows: any[] = []

// Mock useDB() — Nuxt auto-import that returns a Drizzle ORM instance
// The source code uses: useDB().select().from(table).where(...).limit(n)
vi.stubGlobal('useDB', () => ({
  select: () => ({
    from: (table: any) => ({
      where: () => ({
        limit: () => {
          if (table === organization) return Promise.resolve(mockOrgRows)
          if (table === memberTableSchema) return Promise.resolve(mockMemberRows)
          return Promise.resolve([])
        }
      })
    })
  })
}))

// Mock requireServerSession
const mockRequireServerSession = vi.fn()
vi.mock('../../../server/utils/useServerAuth', () => ({
  useServerAuth: () => mockAuthInstance,
  requireServerSession: (...args: unknown[]) => mockRequireServerSession(...args)
}))

describe('server/utils/team', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset config to defaults
    mockConfig = {
      public: {
        crouton: {
          auth: {
            mode: 'multi-tenant',
            defaultTeamId: 'default',
            appName: 'Test App',
            teams: {
              allowCreate: true,
              limit: 5
            }
          }
        }
      }
    }
    // Reset mock implementations
    mockRequireServerSession.mockResolvedValue(createMockSessionResponse())
    // Default DB rows for useDB() mock
    mockOrgRows = [{
      id: 'team-1',
      name: 'Test Team',
      slug: 'test-team',
      logo: null,
      metadata: null,
      personal: 0,
      isDefault: 0,
      ownerId: null,
      createdAt: '2024-01-01T00:00:00.000Z'
    }]
    mockMemberRows = [{
      id: 'member-1',
      organizationId: 'team-1',
      userId: 'user-1',
      role: 'member',
      createdAt: '2024-01-01T00:00:00.000Z'
    }]
    // Keep auth API mocks for functions that still use Better Auth API (getUserTeams, etc.)
    mockAuthApi.listOrganizations.mockResolvedValue([
      { id: 'team-1', name: 'Team 1', slug: 'team-1', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 'team-2', name: 'Team 2', slug: 'team-2', createdAt: '2024-01-01T00:00:00.000Z' }
    ])
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('resolveTeamAndCheckMembership', () => {
    describe('multi-tenant mode', () => {
      beforeEach(() => {
        mockConfig.public.crouton.auth.mode = 'multi-tenant'
      })

      it('should resolve team from URL param', async () => {
        const event = createMockEvent()
        const context = await resolveTeamAndCheckMembership(event)

        expect(context.team).toBeDefined()
        expect(context.team.id).toBe('team-1')
        expect(context.user).toBeDefined()
        expect(context.membership).toBeDefined()
      })

      it('should fall back to session active org', async () => {
        vi.mocked(getRouterParam).mockReturnValue(null)
        mockRequireServerSession.mockResolvedValue(createMockSessionResponse('session-team'))
        mockOrgRows = [{
          id: 'session-team',
          name: 'Session Team',
          slug: 'session-team',
          personal: 0,
          isDefault: 0,
          createdAt: '2024-01-01T00:00:00.000Z'
        }]

        const event = createMockEvent()
        const context = await resolveTeamAndCheckMembership(event)

        expect(context.team.id).toBe('session-team')
      })

      it('should throw 400 when no team context available', async () => {
        vi.mocked(getRouterParam).mockReturnValue(null)
        mockRequireServerSession.mockResolvedValue({
          ...createMockSessionResponse(),
          session: { id: 'session-1', userId: 'user-1', activeOrganizationId: null }
        })

        const event = createMockEvent()
        await expect(resolveTeamAndCheckMembership(event)).rejects.toThrow('No team context available')
      })
    })

    describe('single-tenant mode', () => {
      beforeEach(() => {
        mockConfig.public.crouton.auth.mode = 'single-tenant'
        mockConfig.public.crouton.auth.defaultTeamId = 'default-team'
        mockOrgRows = [{
          id: 'default-team',
          name: 'Default Team',
          slug: 'default',
          isDefault: 1,
          personal: 0,
          createdAt: '2024-01-01T00:00:00.000Z'
        }]
      })

      it('should always use default team', async () => {
        const event = createMockEvent()
        const context = await resolveTeamAndCheckMembership(event)

        expect(context.team.id).toBe('default-team')
      })

      // TODO: Requires proper Nuxt #imports mocking for useRuntimeConfig
      it.todo('should ignore URL param')
    })

    describe('personal mode', () => {
      beforeEach(() => {
        mockConfig.public.crouton.auth.mode = 'personal'
        mockOrgRows = [{
          id: 'personal-user1',
          name: 'User\'s Workspace',
          slug: 'personal-user1',
          personal: 1,
          isDefault: 0,
          ownerId: 'user-1',
          createdAt: '2024-01-01T00:00:00.000Z'
        }]
        mockMemberRows = [{
          id: 'member-1',
          organizationId: 'personal-user1',
          userId: 'user-1',
          role: 'owner',
          createdAt: '2024-01-01T00:00:00.000Z'
        }]
      })

      it('should use personal team from session', async () => {
        mockRequireServerSession.mockResolvedValue(createMockSessionResponse('personal-user1'))

        const event = createMockEvent()
        const context = await resolveTeamAndCheckMembership(event)

        expect(context.team.id).toBe('personal-user1')
        expect(context.team.personal).toBe(true)
      })

      // resolveTeamAndCheckMembership now uses URL param first, then session —
      // mode-based routing was removed when switching to direct DB queries
      it.todo('should ignore URL param')
    })

    describe('error handling', () => {
      it('should throw 401 when not authenticated', async () => {
        mockRequireServerSession.mockRejectedValue(
          Object.assign(new Error('Unauthorized'), { statusCode: 401 })
        )

        const event = createMockEvent()
        await expect(resolveTeamAndCheckMembership(event)).rejects.toThrow('Unauthorized')
      })

      it('should throw 404 when team not found', async () => {
        mockOrgRows = []

        const event = createMockEvent()
        await expect(resolveTeamAndCheckMembership(event)).rejects.toThrow('Team not found')
      })

      it('should throw 403 when not a team member', async () => {
        mockMemberRows = []

        const event = createMockEvent()
        await expect(resolveTeamAndCheckMembership(event)).rejects.toThrow('Not a team member')
      })
    })
  })

  describe('getMembership', () => {
    it('should return member when found', async () => {
      const event = createMockEvent()
      const member = await getMembership(event, 'team-1', 'user-1')

      expect(member).toBeDefined()
      expect(member?.userId).toBe('user-1')
      expect(member?.role).toBe('member')
    })

    it('should return null when member not found', async () => {
      mockMemberRows = []

      const event = createMockEvent()
      const member = await getMembership(event, 'team-1', 'non-existent')

      expect(member).toBeNull()
    })

    it('should return null on DB error', async () => {
      // Temporarily break useDB to simulate an error
      const origUseDB = globalThis.useDB
      vi.stubGlobal('useDB', () => ({
        select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.reject(new Error('DB error')) }) }) })
      }))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const event = createMockEvent()
      const member = await getMembership(event, 'team-1', 'user-1')

      expect(member).toBeNull()
      consoleSpy.mockRestore()
      vi.stubGlobal('useDB', origUseDB)
    })

    it('should map role correctly', async () => {
      mockMemberRows = [{
        id: 'member-1',
        organizationId: 'team-1',
        userId: 'user-1',
        role: 'owner',
        createdAt: '2024-01-01T00:00:00.000Z'
      }]

      const event = createMockEvent()
      const member = await getMembership(event, 'team-1', 'user-1')

      expect(member?.role).toBe('owner')
    })
  })

  describe('getTeamById', () => {
    it('should return team when found', async () => {
      const event = createMockEvent()
      const team = await getTeamById(event, 'team-1')

      expect(team).toBeDefined()
      expect(team?.id).toBe('team-1')
      expect(team?.name).toBe('Test Team')
    })

    it('should return null when team not found', async () => {
      mockOrgRows = []

      const event = createMockEvent()
      const team = await getTeamById(event, 'non-existent')

      expect(team).toBeNull()
    })

    it('should return null on DB error', async () => {
      const origUseDB = globalThis.useDB
      vi.stubGlobal('useDB', () => ({
        select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.reject(new Error('DB error')) }) }) })
      }))

      const event = createMockEvent()
      const team = await getTeamById(event, 'team-1')

      expect(team).toBeNull()
      vi.stubGlobal('useDB', origUseDB)
    })

    it('should map personal flag correctly', async () => {
      mockOrgRows = [{
        id: 'personal-1',
        name: 'Personal Workspace',
        slug: 'personal',
        personal: 1,
        isDefault: 0,
        ownerId: 'user-1',
        createdAt: '2024-01-01T00:00:00.000Z'
      }]

      const event = createMockEvent()
      const team = await getTeamById(event, 'personal-1')

      expect(team?.personal).toBe(true)
      expect(team?.ownerId).toBe('user-1')
    })

    it('should map isDefault flag correctly', async () => {
      mockOrgRows = [{
        id: 'default',
        name: 'Default Workspace',
        slug: 'default',
        isDefault: 1,
        personal: 0,
        createdAt: '2024-01-01T00:00:00.000Z'
      }]

      const event = createMockEvent()
      const team = await getTeamById(event, 'default')

      expect(team?.isDefault).toBe(true)
    })

    it('should handle SQLite boolean values (0/1)', async () => {
      mockOrgRows = [{
        id: 'team-1',
        name: 'Test Team',
        slug: 'test',
        personal: 1, // SQLite returns 1 for true
        isDefault: 0, // SQLite returns 0 for false
        createdAt: '2024-01-01T00:00:00.000Z'
      }]

      const event = createMockEvent()
      const team = await getTeamById(event, 'team-1')

      expect(team?.personal).toBe(true)
      expect(team?.isDefault).toBe(false)
    })

    // TODO: Requires proper Nuxt #imports mocking for useRuntimeConfig - metadata parsing depends on config
    it.todo('should fall back to metadata for legacy data')
  })

  describe('getTeamBySlug', () => {
    it('should return team when found by slug', async () => {
      const event = createMockEvent()
      const team = await getTeamBySlug(event, 'test-team')

      expect(team).toBeDefined()
      expect(team?.slug).toBe('test-team')
    })

    it('should return null when team not found', async () => {
      mockOrgRows = []

      const event = createMockEvent()
      const team = await getTeamBySlug(event, 'non-existent')

      expect(team).toBeNull()
    })
  })

  describe('getUserTeams', () => {
    it('should return list of teams', async () => {
      const event = createMockEvent()
      const teams = await getUserTeams(event)

      expect(teams).toHaveLength(2)
      expect(teams[0].id).toBe('team-1')
      expect(teams[1].id).toBe('team-2')
    })

    it('should return empty array when no teams', async () => {
      mockAuthApi.listOrganizations.mockResolvedValue([])

      const event = createMockEvent()
      const teams = await getUserTeams(event)

      expect(teams).toHaveLength(0)
    })

    it('should return empty array on API error', async () => {
      mockAuthApi.listOrganizations.mockRejectedValue(new Error('API error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const event = createMockEvent()
      const teams = await getUserTeams(event)

      expect(teams).toHaveLength(0)
      consoleSpy.mockRestore()
    })
  })

  describe('canUserCreateTeam', () => {
    it('should return true in multi-tenant mode when under limit', async () => {
      mockConfig.public.crouton.auth.mode = 'multi-tenant'
      mockConfig.public.crouton.auth.teams = { allowCreate: true, limit: 5 }
      mockAuthApi.listOrganizations.mockResolvedValue([
        { id: 'team-1', name: 'Team 1', slug: 'team-1', createdAt: '2024-01-01T00:00:00.000Z' }
      ])

      const event = createMockEvent()
      const canCreate = await canUserCreateTeam(event, 'user-1')

      expect(canCreate).toBe(true)
    })

    // TODO: These tests require proper Nuxt #imports mocking - useRuntimeConfig is imported from #imports, not a global
    it.todo('should return false when at limit')
    it.todo('should return false when allowCreate is false')
    it.todo('should return false in single-tenant mode')
    it.todo('should return false in personal mode')
  })

  describe('requireTeamRole', () => {
    it('should allow owner for any required role', async () => {
      mockMemberRows = [{
        id: 'member-1', organizationId: 'team-1', userId: 'user-1', role: 'owner', createdAt: '2024-01-01T00:00:00.000Z'
      }]

      const event = createMockEvent()

      // Should pass for member requirement
      await expect(requireTeamRole(event, 'member')).resolves.toBeDefined()

      // Should pass for admin requirement
      await expect(requireTeamRole(event, 'admin')).resolves.toBeDefined()

      // Should pass for owner requirement
      await expect(requireTeamRole(event, 'owner')).resolves.toBeDefined()
    })

    it('should allow admin for member/admin roles', async () => {
      mockMemberRows = [{
        id: 'member-1', organizationId: 'team-1', userId: 'user-1', role: 'admin', createdAt: '2024-01-01T00:00:00.000Z'
      }]

      const event = createMockEvent()

      // Should pass for member requirement
      await expect(requireTeamRole(event, 'member')).resolves.toBeDefined()

      // Should pass for admin requirement
      await expect(requireTeamRole(event, 'admin')).resolves.toBeDefined()

      // Should fail for owner requirement
      await expect(requireTeamRole(event, 'owner')).rejects.toThrow('Requires owner role or higher')
    })

    it('should allow member only for member role', async () => {
      const event = createMockEvent()

      // Should pass for member requirement
      await expect(requireTeamRole(event, 'member')).resolves.toBeDefined()

      // Should fail for admin requirement
      await expect(requireTeamRole(event, 'admin')).rejects.toThrow('Requires admin role or higher')

      // Should fail for owner requirement
      await expect(requireTeamRole(event, 'owner')).rejects.toThrow('Requires owner role or higher')
    })
  })

  describe('requireTeamAdmin', () => {
    it('should pass for admin role', async () => {
      mockMemberRows = [{
        id: 'member-1', organizationId: 'team-1', userId: 'user-1', role: 'admin', createdAt: '2024-01-01T00:00:00.000Z'
      }]

      const event = createMockEvent()
      const context = await requireTeamAdmin(event)

      expect(context.membership.role).toBe('admin')
    })

    it('should pass for owner role', async () => {
      mockMemberRows = [{
        id: 'member-1', organizationId: 'team-1', userId: 'user-1', role: 'owner', createdAt: '2024-01-01T00:00:00.000Z'
      }]

      const event = createMockEvent()
      const context = await requireTeamAdmin(event)

      expect(context.membership.role).toBe('owner')
    })

    it('should fail for member role', async () => {
      const event = createMockEvent()
      await expect(requireTeamAdmin(event)).rejects.toThrow('Requires admin role or higher')
    })
  })

  describe('requireTeamOwner', () => {
    it('should pass for owner role', async () => {
      mockMemberRows = [{
        id: 'member-1', organizationId: 'team-1', userId: 'user-1', role: 'owner', createdAt: '2024-01-01T00:00:00.000Z'
      }]

      const event = createMockEvent()
      const context = await requireTeamOwner(event)

      expect(context.membership.role).toBe('owner')
    })

    it('should fail for admin role', async () => {
      mockMemberRows = [{
        id: 'member-1', organizationId: 'team-1', userId: 'user-1', role: 'admin', createdAt: '2024-01-01T00:00:00.000Z'
      }]

      const event = createMockEvent()
      await expect(requireTeamOwner(event)).rejects.toThrow('Requires owner role or higher')
    })

    it('should fail for member role', async () => {
      const event = createMockEvent()
      await expect(requireTeamOwner(event)).rejects.toThrow('Requires owner role or higher')
    })
  })

  // covers: T14
  describe('canEditPages', () => {
    const withRole = (role: string | null) => {
      mockMemberRows = role
        ? [{ id: 'member-1', organizationId: 'team-1', userId: 'user-1', role, createdAt: '2024-01-01T00:00:00.000Z' }]
        : []
    }

    it('is true for admin and owner', async () => {
      withRole('admin')
      expect(await canEditPages('team-1', 'user-1')).toBe(true)
      withRole('owner')
      expect(await canEditPages('team-1', 'user-1')).toBe(true)
    })

    it('is false for a plain member and for a non-member', async () => {
      withRole('member')
      expect(await canEditPages('team-1', 'user-1')).toBe(false)
      withRole(null)
      expect(await canEditPages('team-1', 'user-1')).toBe(false)
    })
  })

  // covers: T14
  describe('getUserTeamsDirect', () => {
    it('reads member joined to organization by user id, no session', async () => {
      const calls: { from?: unknown, join?: unknown, where?: unknown } = {}
      const origUseDB = globalThis.useDB
      vi.stubGlobal('useDB', () => ({
        select: () => ({
          from: (table: unknown) => {
            calls.from = table
            return {
              innerJoin: (joined: unknown) => {
                calls.join = joined
                return {
                  where: (cond: unknown) => {
                    calls.where = cond
                    return Promise.resolve([
                      { id: 'team-1', slug: 'team-one', name: 'Team One', role: 'admin' },
                      { id: 'team-2', slug: 'team-two', name: 'Team Two', role: 'member' }
                    ])
                  }
                }
              }
            }
          }
        })
      }))

      const teams = await getUserTeamsDirect('user-1')

      expect(teams).toEqual([
        { id: 'team-1', slug: 'team-one', name: 'Team One', role: 'admin' },
        { id: 'team-2', slug: 'team-two', name: 'Team Two', role: 'member' }
      ])
      expect(calls.from).toBe(memberTableSchema)
      expect(calls.join).toBe(organization)
      expect(calls.where).toBeDefined()
      expect(mockRequireServerSession).not.toHaveBeenCalled()
      vi.stubGlobal('useDB', origUseDB)
    })
  })
})
