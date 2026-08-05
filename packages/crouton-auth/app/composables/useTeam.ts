/**
 * useTeam Composable
 *
 * Team (organization) management composable with mode-aware behavior.
 * Uses Better Auth's organization client for all operations.
 *
 * @example
 * ```vue
 * <script setup>
 * const { currentTeam, teams, switchTeam, createTeam, canCreateTeam } = useTeam()
 *
 * // Create a new team (multi-tenant mode)
 * if (canCreateTeam.value) {
 *   await createTeam({ name: 'New Team', slug: 'new-team' })
 * }
 *
 * // Switch active team
 * await switchTeam(teamId)
 * </script>
 * ```
 */
import type { Team, MemberRole, Member, MemberWithUser } from '../../types'
import { useAuthClient } from '../../types/auth-client'
import { mapOrganizationToTeam } from '../../shared/utils/auth'

export interface CreateTeamData {
  name: string
  slug?: string
  logo?: string
  metadata?: Record<string, unknown>
}

export interface UpdateTeamData {
  name?: string
  slug?: string
  logo?: string
  metadata?: Record<string, unknown>
}

export interface InviteMemberData {
  email: string
  role?: MemberRole
}

/**
 * Map Better Auth member to our Member type
 */
function mapMember(m: {
  id: string
  organizationId: string
  userId: string
  role: string
  createdAt: string | Date
  user?: {
    id: string
    name?: string | null
    email: string
    image?: string | null
  }
}): MemberWithUser | Member {
  const base: Member = {
    id: m.id,
    organizationId: m.organizationId,
    userId: m.userId,
    role: m.role as MemberRole,
    createdAt: new Date(m.createdAt)
  }
  if (m.user) {
    return {
      ...base,
      user: {
        id: m.user.id,
        name: m.user.name ?? null,
        email: m.user.email,
        image: m.user.image ?? null,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    } as MemberWithUser
  }
  return base
}

/**
 * Extract error message from Better Auth error responses
 *
 * Better Auth can return errors in various formats:
 * - { code: "ORGANIZATION_ALREADY_EXISTS", message: "Organization already exists" }
 * - Standard Error objects
 * - Fetch errors with nested structures
 */
function extractErrorMessage(e: unknown, fallback: string): string {
  // Handle standard Error objects
  if (e instanceof Error) {
    return e.message || fallback
  }

  // Handle Better Auth error objects with code/message
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>

    // Direct message property
    if (typeof obj.message === 'string' && obj.message) {
      return obj.message
    }

    // Nested error object (common in fetch responses)
    if (obj.error && typeof obj.error === 'object') {
      const nested = obj.error as Record<string, unknown>
      if (typeof nested.message === 'string' && nested.message) {
        return nested.message
      }
    }

    // Body with error (fetch response pattern)
    if (obj.body && typeof obj.body === 'object') {
      const body = obj.body as Record<string, unknown>
      if (typeof body.message === 'string' && body.message) {
        return body.message
      }
    }
  }

  return fallback
}

export function useTeam() {
  const config = useAuthConfig()
  const authClient = useAuthClient()

  // Use useSession's activeOrganization which is properly populated via getFullOrganization()
  // This replaces the nanostore atoms which aren't automatically synced
  // Also get activeOrgRaw which includes members array for role checking
  const { activeOrganization: sessionActiveOrg, activeOrgRaw } = useSession()

  // The organizations list comes from useState, NOT from better-auth's
  // `useListOrganizations` nanostore (#1703). We use better-auth's *vanilla*
  // client, so that export is a raw nanostore rather than a Vue ref — and
  // nothing ever subscribes to it, so it is never mounted and its `.value`
  // stays `undefined` forever. Reading it produced a computed with no reactive
  // dependencies that silently cached its first evaluation.
  //
  // This state is populated by `refreshTeams()` below and, crucially, by
  // `team-context.global.ts` during SSR — which is why a full page load
  // resolves the team when a client-side transition sometimes did not.
  const fallbackTeams = useState<Team[]>('crouton-auth-fallback-teams', () => [])

  // Use session's active org instead of nanostore (which doesn't auto-populate)
  const activeOrgData = computed(() => sessionActiveOrg.value)

  // Local state
  const loading = ref(false)
  const error = ref<string | null>(null)
  const membersData = ref<(MemberWithUser | Member)[]>([])

  // Computed: current team (active organization)
  // activeOrgData is already a Team type from useSession
  const currentTeam = computed<Team | null>(() => activeOrgData.value)

  // Computed: all user's teams
  const teams = computed<Team[]>(() => fallbackTeams.value)

  // Fetch teams via API as fallback when nanostore atom stays pending
  async function refreshTeams(): Promise<void> {
    if (!import.meta.client) return
    try {
      const result = await authClient?.organization?.list?.()
      if (result?.data && result.data.length > 0) {
        fallbackTeams.value = result.data.map(mapOrganizationToTeam)
      }
    } catch {
      // Silently fail — teams just won't be shown in switcher
    }
  }

  // Computed: team members (loaded separately)
  const members = computed(() => membersData.value)

  // Get current user's role in active team
  // Uses raw org data from getFullOrganization() which includes members array
  const currentRole = computed<MemberRole | null>(() => {
    const { user } = useSession()
    if (!user.value) return null

    const rawOrg = activeOrgRaw.value as {
      members?: Array<{ userId: string; role: string }>
    } | null

    if (!rawOrg?.members) return null

    const member = rawOrg.members.find(m => m.userId === user.value?.id)
    return (member?.role as MemberRole) ?? null
  })

  // Flag-based computed properties
  const showTeamSwitcher = computed(() => {
    if (config?.teams?.showSwitcher === false) return false
    return teams.value.length > 1
  })

  const showTeamManagement = computed(() => {
    return config?.teams?.showManagement !== false
  })

  const canCreateTeam = computed(() => {
    if (config?.teams?.allowCreate === false) return false
    const limit = config?.teams?.limit ?? 0 // 0 = unlimited
    if (limit === 0) return true
    return teams.value.length < limit
  })

  const canInviteMembers = computed(() => {
    const role = currentRole.value
    return role === 'owner' || role === 'admin'
  })

  const canManageMembers = computed(() => {
    const role = currentRole.value
    return role === 'owner' || role === 'admin'
  })

  const isOwner = computed(() => currentRole.value === 'owner')
  const isAdmin = computed(() => {
    const role = currentRole.value
    return role === 'owner' || role === 'admin'
  })

  // ============================================================================
  // Team Methods
  // ============================================================================

  /**
   * Switch to a different team (set as active organization)
   */
  async function switchTeam(teamId: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await authClient.organization.setActive({
        organizationId: teamId
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to switch team')
      }
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to switch team')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  /**
   * Switch to team by slug
   */
  async function switchTeamBySlug(slug: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await authClient.organization.setActive({
        organizationSlug: slug
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to switch team')
      }
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to switch team')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  /**
   * Create a new team (multi-tenant mode only)
   */
  async function createTeam(data: CreateTeamData): Promise<Team> {
    loading.value = true
    error.value = null
    try {
      if (!canCreateTeam.value) {
        throw new Error('Cannot create more teams. Limit reached or not in multi-tenant mode.')
      }

      const result = await authClient.organization.create({
        name: data.name,
        slug: data.slug!,
        logo: data.logo,
        metadata: data.metadata
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to create team')
      }

      if (!result.data) {
        throw new Error('No data returned from create team')
      }

      // Set the newly created org as active so the session cookie reflects it
      // before any navigation happens (prevents hydration mismatch)
      await authClient.organization.setActive({
        organizationId: result.data.id
      })

      return mapOrganizationToTeam(result.data)
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to create team')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  /**
   * Update the current team
   */
  async function updateTeam(data: UpdateTeamData): Promise<Team> {
    loading.value = true
    error.value = null
    try {
      if (!currentTeam.value) {
        throw new Error('No active team to update')
      }

      const result = await authClient.organization.update({
        organizationId: currentTeam.value.id,
        data: {
          name: data.name,
          slug: data.slug,
          logo: data.logo,
          metadata: data.metadata
        }
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to update team')
      }

      if (!result.data) {
        throw new Error('No data returned from update team')
      }

      return mapOrganizationToTeam(result.data)
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to update team')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  /**
   * Delete the current team (owner only)
   */
  async function deleteTeam(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (!currentTeam.value) {
        throw new Error('No active team to delete')
      }

      if (!isOwner.value) {
        throw new Error('Only the team owner can delete the team')
      }

      const result = await authClient.organization.delete({
        organizationId: currentTeam.value.id
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to delete team')
      }
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to delete team')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  // ============================================================================
  // Member Methods
  // ============================================================================

  /**
   * Load members for the current team
   */
  async function loadMembers(): Promise<void> {
    if (!currentTeam.value) {
      membersData.value = []
      return
    }

    try {
      const result = await authClient.organization.listMembers({
        query: { organizationId: currentTeam.value.id }
      })

      if (result.error) {
        console.error('Failed to load members:', result.error)
        membersData.value = []
        return
      }

      membersData.value = (result.data?.members ?? []).map(mapMember)
    } catch (e) {
      console.error('Failed to load members:', e)
      membersData.value = []
    }
  }

  /**
   * Invite a new member to the current team
   */
  async function inviteMember(data: InviteMemberData): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (!currentTeam.value) {
        throw new Error('No active team')
      }

      if (!canInviteMembers.value) {
        throw new Error('You do not have permission to invite members')
      }

      const result = await authClient.organization.inviteMember({
        organizationId: currentTeam.value.id,
        email: data.email,
        role: data.role ?? 'member'
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to invite member')
      }
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to invite member')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  /**
   * Remove a member from the current team
   */
  async function removeMember(memberIdOrEmail: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (!currentTeam.value) {
        throw new Error('No active team')
      }

      if (!canManageMembers.value) {
        throw new Error('You do not have permission to remove members')
      }

      const result = await authClient.organization.removeMember({
        organizationId: currentTeam.value.id,
        memberIdOrEmail
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to remove member')
      }

      // Refresh members list
      await loadMembers()
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to remove member')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  /**
   * Update a member's role
   */
  async function updateMemberRole(memberId: string, role: MemberRole): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (!currentTeam.value) {
        throw new Error('No active team')
      }

      if (!canManageMembers.value) {
        throw new Error('You do not have permission to manage members')
      }

      const result = await authClient.organization.updateMemberRole({
        organizationId: currentTeam.value.id,
        memberId,
        role
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to update role')
      }

      // Refresh members list
      await loadMembers()
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to update role')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  /**
   * Leave the current team
   */
  async function leaveTeam(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (!currentTeam.value) {
        throw new Error('No active team')
      }

      if (isOwner.value) {
        throw new Error('Team owner cannot leave. Transfer ownership or delete the team.')
      }

      // Get current user
      const { user } = useSession()
      if (!user.value) {
        throw new Error('Not authenticated')
      }

      const result = await authClient.organization.removeMember({
        organizationId: currentTeam.value.id,
        memberIdOrEmail: user.value.id
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to leave team')
      }
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to leave team')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  // ============================================================================
  // Invitation Methods
  // ============================================================================

  /**
   * Get pending invitations for the current team
   */
  async function getPendingInvitations() {
    if (!currentTeam.value) return []

    try {
      const result = await authClient.organization.listInvitations({
        query: { organizationId: currentTeam.value.id }
      })

      if (result.error) {
        console.error('Failed to get invitations:', result.error)
        return []
      }

      // Better Auth 1.4.x returns array directly, not { invitations: [...] }
      return result.data ?? []
    } catch (e) {
      console.error('Failed to get invitations:', e)
      return []
    }
  }

  /**
   * Cancel a pending invitation
   */
  async function cancelInvitation(invitationId: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await authClient.organization.cancelInvitation({
        invitationId
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to cancel invitation')
      }
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to cancel invitation')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  /**
   * Accept an invitation (for the current user)
   */
  async function acceptInvitation(invitationId: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await authClient.organization.acceptInvitation({
        invitationId
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to accept invitation')
      }
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to accept invitation')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  /**
   * Reject an invitation (for the current user)
   */
  async function rejectInvitation(invitationId: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await authClient.organization.rejectInvitation({
        invitationId
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to reject invitation')
      }
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to reject invitation')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  /**
   * Resend an invitation email for a pending invitation
   */
  async function resendInvitation(invitationId: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      await $fetch(`/api/auth/invitations/${invitationId}/resend`, {
        method: 'POST',
      })
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Failed to resend invitation')
      error.value = message
      throw new Error(message)
    } finally {
      loading.value = false
    }
  }

  return {
    // State
    currentTeam,
    teams,
    members,
    currentRole,
    loading: readonly(loading),
    error: readonly(error),

    // Mode-aware flags
    showTeamSwitcher,
    showTeamManagement,
    canCreateTeam,
    canInviteMembers,
    canManageMembers,
    isOwner,
    isAdmin,

    // Team methods
    switchTeam,
    switchTeamBySlug,
    createTeam,
    updateTeam,
    deleteTeam,
    refreshTeams,

    // Member methods
    loadMembers,
    inviteMember,
    removeMember,
    updateMemberRole,
    leaveTeam,

    // Invitation methods
    getPendingInvitations,
    cancelInvitation,
    acceptInvitation,
    rejectInvitation,
    resendInvitation
  }
}
