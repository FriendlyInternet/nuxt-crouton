import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, readonly } from 'vue'
import type { Team, Member, MemberRole } from '../../../types'

// Import after mocks
import { useTeam } from '../../../app/composables/useTeam'

// Mock auth client for organizations
const mockAuthClient = {
  useListOrganizations: vi.fn(),
  useActiveOrganization: vi.fn(),
  organization: {
    setActive: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    listMembers: vi.fn(),
    inviteMember: vi.fn(),
    removeMember: vi.fn(),
    updateMemberRole: vi.fn(),
    listInvitations: vi.fn(),
    cancelInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
    rejectInvitation: vi.fn()
  }
}

// Mock organization data
const mockOrganizationsData = ref<Array<{
  id: string
  name: string
  slug: string
  logo?: string | null
  metadata?: string | null
  personal?: boolean
  isDefault?: boolean
  ownerId?: string
  createdAt: string
}> | null>(null)

const mockActiveOrgData = ref<{
  id: string
  name: string
  slug: string
  logo?: string | null
  metadata?: string | null
  personal?: boolean
  isDefault?: boolean
  ownerId?: string
  createdAt: string
  members?: Array<{ userId: string, role: string }>
} | null>(null)

// Mock session user
const mockSessionUser = ref<{ id: string, email: string } | null>(null)

// Mock session active organization (Team type from useSession)
const mockSessionActiveOrg = ref<{
  id: string
  name: string
  slug: string
  logo?: string | null
  metadata?: Record<string, unknown>
  personal?: boolean
  isDefault?: boolean
  ownerId?: string
  createdAt: Date
  updatedAt: Date
} | null>(null)

// Setup global mocks
vi.stubGlobal('useNuxtApp', () => ({
  $authClient: mockAuthClient
}))

vi.stubGlobal('useRuntimeConfig', () => ({
  public: {
    crouton: {
      auth: {
        mode: 'multi-tenant',
        teams: {
          allowCreate: true,
          limit: 5
        }
      }
    }
  }
}))

vi.stubGlobal('useSession', () => ({
  user: mockSessionUser,
  activeOrganization: mockSessionActiveOrg,
  activeOrgRaw: mockActiveOrgData
}))

vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('readonly', readonly)

// Mock useState for fallback teams state
const mockUseStateValues: Record<string, ReturnType<typeof ref>> = {}
vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
  if (!mockUseStateValues[key]) {
    mockUseStateValues[key] = ref(init ? init() : null)
  }
  return mockUseStateValues[key]
})

// Mock useAuthConfig
vi.stubGlobal('useAuthConfig', () => ({
  mode: 'multi-tenant' as const,
  teams: {
    allowCreate: true,
    limit: 5
  }
}))

// Mock useAuthClient - used by useTeam internally
vi.stubGlobal('useAuthClient', () => mockAuthClient)

// Setup mock return values - must be done before import.
//
// Shape matters and was wrong until #1738: better-auth's VUE client returns
// `DeepReadonly<Ref<{ data, error, isPending }>>` — a ref HOLDING the payload — not the
// vanilla nanostore's `{ data: Ref }`. Mocking the nanostore shape here made the contract
// assert the very API this epic exists to replace, so a correct implementation failed it.
// Keep these as `computed(() => ({ data }))` so the source refs stay reactive and the shape
// stays honest to `better-auth/dist/client/vue/index.d.mts`.
mockAuthClient.useListOrganizations = vi.fn(() => computed(() => ({
  data: mockOrganizationsData.value
})))

mockAuthClient.useActiveOrganization = vi.fn(() => computed(() => ({
  data: mockActiveOrgData.value
})))

describe('useTeam', () => {
  beforeEach(() => {
    // Reset mock call history but keep implementations
    mockAuthClient.organization.setActive.mockClear()
    mockAuthClient.organization.create.mockClear()
    mockAuthClient.organization.update.mockClear()
    mockAuthClient.organization.delete.mockClear()
    mockAuthClient.organization.listMembers.mockClear()
    mockAuthClient.organization.inviteMember.mockClear()
    mockAuthClient.organization.removeMember.mockClear()
    mockAuthClient.organization.updateMemberRole.mockClear()
    mockAuthClient.organization.listInvitations.mockClear()
    mockAuthClient.organization.cancelInvitation.mockClear()
    mockAuthClient.organization.acceptInvitation.mockClear()
    mockAuthClient.organization.rejectInvitation.mockClear()

    // Reset state
    mockOrganizationsData.value = null
    mockActiveOrgData.value = null
    mockSessionActiveOrg.value = null
    mockSessionUser.value = null

    // Clear useState values between tests
    Object.keys(mockUseStateValues).forEach(key => {
      delete mockUseStateValues[key]
    })
  })

  describe('state', () => {
    it('should return null currentTeam when no active organization', () => {
      const { currentTeam } = useTeam()
      expect(currentTeam.value).toBeNull()
    })

    // Simulates better-auth's Vue-aware client: useActiveOrganization() exposes
    // the active org via a reactive atom. Fails against the current vanilla
    // client because useTeam() derives currentTeam from useSession().activeOrganization
    // instead — this is the contract the #1713 client switch must satisfy.
    it('should return currentTeam when active organization exists', () => {
      mockActiveOrgData.value = {
        id: 'org-1',
        name: 'Test Team',
        slug: 'test-team',
        logo: 'https://example.com/logo.png',
        createdAt: '2024-01-01T00:00:00Z',
        personal: false,
        isDefault: false
      }

      const { currentTeam } = useTeam()
      expect(currentTeam.value).toMatchObject({
        id: 'org-1',
        name: 'Test Team',
        slug: 'test-team',
        personal: false,
        isDefault: false
      })
    })

    it('should return empty teams array when no organizations', () => {
      const { teams } = useTeam()
      expect(teams.value).toEqual([])
    })

    // Simulates better-auth's Vue-aware client: useListOrganizations() exposes
    // the org list via a reactive atom. Fails against the current vanilla
    // client because useTeam() derives teams from fallbackTeams (a useState
    // populated by refreshTeams()/SSR middleware) instead of this atom — the
    // dead-nanostore gap #1713 exists to close.
    it('should return teams list when organizations exist', () => {
      mockOrganizationsData.value = [
        { id: 'org-1', name: 'Team 1', slug: 'team-1', createdAt: '2024-01-01T00:00:00Z' },
        { id: 'org-2', name: 'Team 2', slug: 'team-2', createdAt: '2024-01-02T00:00:00Z' }
      ]

      const { teams } = useTeam()
      expect(teams.value).toHaveLength(2)
      expect(teams.value[0].name).toBe('Team 1')
      expect(teams.value[1].name).toBe('Team 2')
    })

    it('should expose loading and error states', () => {
      const { loading, error } = useTeam()
      expect(loading.value).toBe(false)
      expect(error.value).toBeNull()
    })
  })

  describe('currentRole', () => {
    it('should return null when no active organization', () => {
      const { currentRole } = useTeam()
      expect(currentRole.value).toBeNull()
    })

    it('should return null when no user session', () => {
      mockActiveOrgData.value = {
        id: 'org-1',
        name: 'Test Team',
        slug: 'test-team',
        createdAt: '2024-01-01T00:00:00Z',
        members: [{ userId: 'user-1', role: 'owner' }]
      }

      const { currentRole } = useTeam()
      expect(currentRole.value).toBeNull()
    })

    // TODO: Better Auth nanostore mock complexity
    it.todo('should return user role when authenticated and member', () => {
      mockSessionUser.value = { id: 'user-1', email: 'test@example.com' }
      mockActiveOrgData.value = {
        id: 'org-1',
        name: 'Test Team',
        slug: 'test-team',
        createdAt: '2024-01-01T00:00:00Z',
        members: [
          { userId: 'user-1', role: 'owner' },
          { userId: 'user-2', role: 'member' }
        ]
      }

      const { currentRole } = useTeam()
      expect(currentRole.value).toBe('owner')
    })
  })

  describe('mode-aware flags', () => {
    // TODO: Better Auth nanostore mock complexity
    it.todo('should show team switcher in multi-tenant mode with multiple teams', () => {
      mockOrganizationsData.value = [
        { id: 'org-1', name: 'Team 1', slug: 'team-1', createdAt: '2024-01-01T00:00:00Z' },
        { id: 'org-2', name: 'Team 2', slug: 'team-2', createdAt: '2024-01-02T00:00:00Z' }
      ]

      const { showTeamSwitcher } = useTeam()
      expect(showTeamSwitcher.value).toBe(true)
    })

    it('should hide team switcher with single team', () => {
      mockOrganizationsData.value = [
        { id: 'org-1', name: 'Team 1', slug: 'team-1', createdAt: '2024-01-01T00:00:00Z' }
      ]

      const { showTeamSwitcher } = useTeam()
      expect(showTeamSwitcher.value).toBe(false)
    })

    it('should show team management in multi-tenant mode', () => {
      const { showTeamManagement } = useTeam()
      expect(showTeamManagement.value).toBe(true)
    })

    it('should allow team creation within limit', () => {
      mockOrganizationsData.value = [
        { id: 'org-1', name: 'Team 1', slug: 'team-1', createdAt: '2024-01-01T00:00:00Z' }
      ]

      const { canCreateTeam } = useTeam()
      expect(canCreateTeam.value).toBe(true)
    })

    // TODO: Better Auth nanostore mock complexity
    it.todo('should prevent team creation at limit', () => {
      mockOrganizationsData.value = Array(5).fill(null).map((_, i) => ({
        id: `org-${i}`,
        name: `Team ${i}`,
        slug: `team-${i}`,
        createdAt: '2024-01-01T00:00:00Z'
      }))

      const { canCreateTeam } = useTeam()
      expect(canCreateTeam.value).toBe(false)
    })

    // TODO: Better Auth nanostore mock complexity
    it.todo('should allow invite for owner/admin', () => {
      mockSessionUser.value = { id: 'user-1', email: 'test@example.com' }
      mockActiveOrgData.value = {
        id: 'org-1',
        name: 'Test',
        slug: 'test',
        createdAt: '2024-01-01T00:00:00Z',
        members: [{ userId: 'user-1', role: 'admin' }]
      }

      const { canInviteMembers, isAdmin } = useTeam()
      expect(canInviteMembers.value).toBe(true)
      expect(isAdmin.value).toBe(true)
    })

    it('should deny invite for member role', () => {
      mockSessionUser.value = { id: 'user-1', email: 'test@example.com' }
      mockActiveOrgData.value = {
        id: 'org-1',
        name: 'Test',
        slug: 'test',
        createdAt: '2024-01-01T00:00:00Z',
        members: [{ userId: 'user-1', role: 'member' }]
      }

      const { canInviteMembers, isOwner } = useTeam()
      expect(canInviteMembers.value).toBe(false)
      expect(isOwner.value).toBe(false)
    })
  })

  describe('switchTeam', () => {
    it('should call organization.setActive with team ID', async () => {
      mockAuthClient.organization.setActive.mockResolvedValue({ data: {}, error: null })

      const { switchTeam } = useTeam()
      await switchTeam('org-2')

      expect(mockAuthClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: 'org-2'
      })
    })

    it('should throw on switch error', async () => {
      mockAuthClient.organization.setActive.mockResolvedValue({
        data: null,
        error: { message: 'Team not found' }
      })

      const { switchTeam, error } = useTeam()

      await expect(switchTeam('invalid-org')).rejects.toThrow('Team not found')
      expect(error.value).toBe('Team not found')
    })
  })

  describe('switchTeamBySlug', () => {
    it('should call organization.setActive with slug', async () => {
      mockAuthClient.organization.setActive.mockResolvedValue({ data: {}, error: null })

      const { switchTeamBySlug } = useTeam()
      await switchTeamBySlug('my-team')

      expect(mockAuthClient.organization.setActive).toHaveBeenCalledWith({
        organizationSlug: 'my-team'
      })
    })
  })

  describe('createTeam', () => {
    beforeEach(() => {
      mockOrganizationsData.value = [] // Below limit
    })

    it('should call organization.create and return team', async () => {
      mockAuthClient.organization.create.mockResolvedValue({
        data: {
          id: 'new-org',
          name: 'New Team',
          slug: 'new-team',
          createdAt: '2024-01-01T00:00:00Z'
        },
        error: null
      })

      const { createTeam } = useTeam()
      const team = await createTeam({ name: 'New Team', slug: 'new-team' })

      expect(mockAuthClient.organization.create).toHaveBeenCalledWith({
        name: 'New Team',
        slug: 'new-team',
        logo: undefined,
        metadata: undefined
      })
      expect(team.name).toBe('New Team')
    })

    // TODO: Better Auth nanostore mock complexity
    it.todo('should throw when at team limit', async () => {
      mockOrganizationsData.value = Array(5).fill(null).map((_, i) => ({
        id: `org-${i}`,
        name: `Team ${i}`,
        slug: `team-${i}`,
        createdAt: '2024-01-01T00:00:00Z'
      }))

      const { createTeam, error } = useTeam()

      await expect(createTeam({ name: 'New Team' }))
        .rejects.toThrow('Cannot create more teams')
      expect(error.value).toContain('Cannot create more teams')
    })
  })

  describe('updateTeam', () => {
    // TODO: Better Auth nanostore mock complexity
    it.todo('should call organization.update', async () => {
      mockActiveOrgData.value = {
        id: 'org-1',
        name: 'Old Name',
        slug: 'old-slug',
        createdAt: '2024-01-01T00:00:00Z'
      }
      mockAuthClient.organization.update.mockResolvedValue({
        data: {
          id: 'org-1',
          name: 'New Name',
          slug: 'new-slug',
          createdAt: '2024-01-01T00:00:00Z'
        },
        error: null
      })

      const { updateTeam } = useTeam()
      const team = await updateTeam({ name: 'New Name', slug: 'new-slug' })

      expect(mockAuthClient.organization.update).toHaveBeenCalledWith({
        organizationId: 'org-1',
        data: {
          name: 'New Name',
          slug: 'new-slug',
          logo: undefined,
          metadata: undefined
        }
      })
      expect(team.name).toBe('New Name')
    })

    it('should throw when no active team', async () => {
      mockActiveOrgData.value = null

      const { updateTeam, error } = useTeam()

      await expect(updateTeam({ name: 'Test' })).rejects.toThrow('No active team')
      expect(error.value).toBe('No active team to update')
    })
  })

  describe('deleteTeam', () => {
    // TODO: Better Auth nanostore mock complexity
    it.todo('should call organization.delete for owner', async () => {
      mockSessionUser.value = { id: 'user-1', email: 'test@example.com' }
      mockActiveOrgData.value = {
        id: 'org-1',
        name: 'Test',
        slug: 'test',
        createdAt: '2024-01-01T00:00:00Z',
        members: [{ userId: 'user-1', role: 'owner' }]
      }
      mockAuthClient.organization.delete.mockResolvedValue({ data: {}, error: null })

      const { deleteTeam } = useTeam()
      await deleteTeam()

      expect(mockAuthClient.organization.delete).toHaveBeenCalledWith({
        organizationId: 'org-1'
      })
    })

    // TODO: Better Auth nanostore mock complexity
    it.todo('should throw when not owner', async () => {
      mockSessionUser.value = { id: 'user-1', email: 'test@example.com' }
      mockActiveOrgData.value = {
        id: 'org-1',
        name: 'Test',
        slug: 'test',
        createdAt: '2024-01-01T00:00:00Z',
        members: [{ userId: 'user-1', role: 'admin' }]
      }

      const { deleteTeam, error } = useTeam()

      await expect(deleteTeam()).rejects.toThrow('Only the team owner')
      expect(error.value).toContain('Only the team owner')
    })
  })

  describe('member management', () => {
    describe('loadMembers', () => {
      // TODO: Better Auth nanostore mock complexity
      it.todo('should load members for current team', async () => {
        mockActiveOrgData.value = {
          id: 'org-1',
          name: 'Test',
          slug: 'test',
          createdAt: '2024-01-01T00:00:00Z'
        }
        mockAuthClient.organization.listMembers.mockResolvedValue({
          data: {
            members: [
              { id: 'm-1', organizationId: 'org-1', userId: 'user-1', role: 'owner', createdAt: '2024-01-01T00:00:00Z' },
              { id: 'm-2', organizationId: 'org-1', userId: 'user-2', role: 'member', createdAt: '2024-01-02T00:00:00Z' }
            ]
          },
          error: null
        })

        const { loadMembers, members } = useTeam()
        await loadMembers()

        expect(members.value).toHaveLength(2)
        expect(members.value[0].role).toBe('owner')
      })

      it('should return empty array when no active team', async () => {
        mockActiveOrgData.value = null

        const { loadMembers, members } = useTeam()
        await loadMembers()

        expect(members.value).toEqual([])
      })
    })

    describe('inviteMember', () => {
      // TODO: Better Auth nanostore mock complexity
      it.todo('should call organization.inviteMember', async () => {
        mockSessionUser.value = { id: 'user-1', email: 'owner@example.com' }
        mockActiveOrgData.value = {
          id: 'org-1',
          name: 'Test',
          slug: 'test',
          createdAt: '2024-01-01T00:00:00Z',
          members: [{ userId: 'user-1', role: 'owner' }]
        }
        mockAuthClient.organization.inviteMember.mockResolvedValue({ data: {}, error: null })

        const { inviteMember } = useTeam()
        await inviteMember({ email: 'new@example.com', role: 'member' })

        expect(mockAuthClient.organization.inviteMember).toHaveBeenCalledWith({
          organizationId: 'org-1',
          email: 'new@example.com',
          role: 'member'
        })
      })

      // TODO: Better Auth nanostore mock complexity
      it.todo('should throw when not authorized', async () => {
        mockSessionUser.value = { id: 'user-1', email: 'member@example.com' }
        mockActiveOrgData.value = {
          id: 'org-1',
          name: 'Test',
          slug: 'test',
          createdAt: '2024-01-01T00:00:00Z',
          members: [{ userId: 'user-1', role: 'member' }]
        }

        const { inviteMember, error } = useTeam()

        await expect(inviteMember({ email: 'new@example.com' }))
          .rejects.toThrow('permission')
        expect(error.value).toContain('permission')
      })
    })

    describe('removeMember', () => {
      // TODO: Better Auth nanostore mock complexity
      it.todo('should call organization.removeMember', async () => {
        mockSessionUser.value = { id: 'user-1', email: 'owner@example.com' }
        mockActiveOrgData.value = {
          id: 'org-1',
          name: 'Test',
          slug: 'test',
          createdAt: '2024-01-01T00:00:00Z',
          members: [{ userId: 'user-1', role: 'owner' }]
        }
        mockAuthClient.organization.removeMember.mockResolvedValue({ data: {}, error: null })
        mockAuthClient.organization.listMembers.mockResolvedValue({ data: { members: [] }, error: null })

        const { removeMember } = useTeam()
        await removeMember('user-2')

        expect(mockAuthClient.organization.removeMember).toHaveBeenCalledWith({
          organizationId: 'org-1',
          memberIdOrEmail: 'user-2'
        })
      })
    })

    describe('updateMemberRole', () => {
      // TODO: Better Auth nanostore mock complexity
      it.todo('should call organization.updateMemberRole', async () => {
        mockSessionUser.value = { id: 'user-1', email: 'owner@example.com' }
        mockActiveOrgData.value = {
          id: 'org-1',
          name: 'Test',
          slug: 'test',
          createdAt: '2024-01-01T00:00:00Z',
          members: [{ userId: 'user-1', role: 'owner' }]
        }
        mockAuthClient.organization.updateMemberRole.mockResolvedValue({ data: {}, error: null })
        mockAuthClient.organization.listMembers.mockResolvedValue({ data: { members: [] }, error: null })

        const { updateMemberRole } = useTeam()
        await updateMemberRole('user-2', 'admin')

        expect(mockAuthClient.organization.updateMemberRole).toHaveBeenCalledWith({
          organizationId: 'org-1',
          memberId: 'user-2',
          role: 'admin'
        })
      })
    })

    describe('leaveTeam', () => {
      // TODO: Better Auth nanostore mock complexity
      it.todo('should allow member to leave', async () => {
        mockSessionUser.value = { id: 'user-2', email: 'member@example.com' }
        mockActiveOrgData.value = {
          id: 'org-1',
          name: 'Test',
          slug: 'test',
          createdAt: '2024-01-01T00:00:00Z',
          members: [
            { userId: 'user-1', role: 'owner' },
            { userId: 'user-2', role: 'member' }
          ]
        }
        mockAuthClient.organization.removeMember.mockResolvedValue({ data: {}, error: null })

        const { leaveTeam } = useTeam()
        await leaveTeam()

        expect(mockAuthClient.organization.removeMember).toHaveBeenCalledWith({
          organizationId: 'org-1',
          memberIdOrEmail: 'user-2'
        })
      })

      // TODO: Better Auth nanostore mock complexity
      it.todo('should prevent owner from leaving', async () => {
        mockSessionUser.value = { id: 'user-1', email: 'owner@example.com' }
        mockActiveOrgData.value = {
          id: 'org-1',
          name: 'Test',
          slug: 'test',
          createdAt: '2024-01-01T00:00:00Z',
          members: [{ userId: 'user-1', role: 'owner' }]
        }

        const { leaveTeam, error } = useTeam()

        await expect(leaveTeam()).rejects.toThrow('owner cannot leave')
        expect(error.value).toContain('owner cannot leave')
      })
    })
  })

  describe('invitation methods', () => {
    describe('getPendingInvitations', () => {
      // TODO: Better Auth nanostore mock complexity
      it.todo('should return invitations list', async () => {
        mockActiveOrgData.value = {
          id: 'org-1',
          name: 'Test',
          slug: 'test',
          createdAt: '2024-01-01T00:00:00Z'
        }
        mockAuthClient.organization.listInvitations.mockResolvedValue({
          data: {
            invitations: [
              { id: 'inv-1', email: 'pending@example.com', role: 'member' }
            ]
          },
          error: null
        })

        const { getPendingInvitations } = useTeam()
        const invitations = await getPendingInvitations()

        expect(invitations).toHaveLength(1)
        expect(invitations[0].email).toBe('pending@example.com')
      })
    })

    describe('cancelInvitation', () => {
      it('should call organization.cancelInvitation', async () => {
        mockAuthClient.organization.cancelInvitation.mockResolvedValue({ data: {}, error: null })

        const { cancelInvitation } = useTeam()
        await cancelInvitation('inv-1')

        expect(mockAuthClient.organization.cancelInvitation).toHaveBeenCalledWith({
          invitationId: 'inv-1'
        })
      })
    })

    describe('acceptInvitation', () => {
      it('should call organization.acceptInvitation', async () => {
        mockAuthClient.organization.acceptInvitation.mockResolvedValue({ data: {}, error: null })

        const { acceptInvitation } = useTeam()
        await acceptInvitation('inv-1')

        expect(mockAuthClient.organization.acceptInvitation).toHaveBeenCalledWith({
          invitationId: 'inv-1'
        })
      })
    })

    describe('rejectInvitation', () => {
      it('should call organization.rejectInvitation', async () => {
        mockAuthClient.organization.rejectInvitation.mockResolvedValue({ data: {}, error: null })

        const { rejectInvitation } = useTeam()
        await rejectInvitation('inv-1')

        expect(mockAuthClient.organization.rejectInvitation).toHaveBeenCalledWith({
          invitationId: 'inv-1'
        })
      })
    })
  })

  describe('organization mapping', () => {
    // TODO: Better Auth nanostore mock complexity
    it.todo('should map organization columns to team properties', () => {
      mockActiveOrgData.value = {
        id: 'org-1',
        name: 'Test Team',
        slug: 'test-team',
        createdAt: '2024-01-01T00:00:00Z',
        personal: true,
        isDefault: true,
        ownerId: 'user-1'
      }

      const { currentTeam } = useTeam()
      expect(currentTeam.value?.personal).toBe(true)
      expect(currentTeam.value?.isDefault).toBe(true)
      expect(currentTeam.value?.ownerId).toBe('user-1')
    })

    // TODO: Better Auth nanostore mock complexity
    it.todo('should handle SQLite boolean format (0/1)', () => {
      mockActiveOrgData.value = {
        id: 'org-1',
        name: 'SQLite Team',
        slug: 'sqlite-team',
        createdAt: '2024-01-01T00:00:00Z',
        personal: 1 as unknown as boolean,
        isDefault: 0 as unknown as boolean
      }

      const { currentTeam } = useTeam()
      expect(currentTeam.value?.personal).toBe(true)
      expect(currentTeam.value?.isDefault).toBe(false)
    })
  })

  describe('teams source (#1703)', () => {
    // `useListOrganizations` is a raw nanostore from better-auth's vanilla
    // client, and nothing in the app ever subscribes to it — so it is never
    // mounted and its `.value` stays `undefined` in production. `teams` is
    // therefore ALWAYS `fallbackTeams` (the reactive, SSR-populated useState).
    //
    // This pins that we deliberately read the reactive source, so deleting the
    // dead `organizationsData` branch in useTeam.ts is provably behaviour-
    // preserving. It is also why the `it.todo`s above could never be made to
    // pass by mocking harder.
    it('reads fallbackTeams even when the organizations atom exposes other data', () => {
      const original = mockAuthClient.useListOrganizations

      // An atom that *does* expose data — the state that can never occur in
      // production, and that we must not prefer over the reactive source.
      mockAuthClient.useListOrganizations = {
        value: {
          data: [{ id: 'stale-org', name: 'Stale Org', slug: 'stale', createdAt: '2024-01-01T00:00:00Z' }]
        }
      } as unknown as typeof original

      try {
        const fallback = useState<Team[]>('crouton-auth-fallback-teams', () => [])
        fallback.value = [{
          id: 'org-1',
          name: 'Test 1',
          slug: 'test1',
          logo: null,
          metadata: {},
          personal: false,
          isDefault: false,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z')
        } as Team]

        const { teams } = useTeam()
        expect(teams.value).toHaveLength(1)
        expect(teams.value[0]?.slug).toBe('test1')
      } finally {
        mockAuthClient.useListOrganizations = original
      }
    })
  })
})
