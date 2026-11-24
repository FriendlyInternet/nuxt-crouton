/**
 * Resend invitation email
 *
 * POST /api/auth/invitations/:id/resend
 *
 * Requires authenticated user who is admin/owner of the invitation's organization.
 * Re-fires the crouton:auth:email hook to resend the invitation email.
 */
import { eq } from 'drizzle-orm'
import { invitation, organization, user } from '../../../../database/schema/auth'
import { requireAuth } from '../../../../utils/auth'
import { getOrganizationMembershipDirect } from '../../../../utils/team'
import { can } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ status: 400, statusText: 'Invitation ID is required' })
  }

  // Require authenticated user
  const currentUser = await requireAuth(event)
  const currentUserId = currentUser.id

  const db = useDB()

  // Fetch invitation with org and inviter details
  const result = await (db as any)
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
      inviterId: invitation.inviterId,
      organizationName: organization.name,
      inviterName: user.name,
      inviterEmail: user.email,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId as any, organization.id))
    .innerJoin(user, eq(invitation.inviterId as any, user.id))
    .where(eq(invitation.id as any, id))
    .get()

  if (!result) {
    throw createError({ status: 404, statusText: 'Invitation not found' })
  }

  // Only allow resending pending invitations
  if (result.status !== 'pending') {
    throw createError({ status: 400, statusText: 'Only pending invitations can be resent' })
  }

  // Check if expired
  const now = new Date()
  if (result.expiresAt && new Date(result.expiresAt) < now) {
    throw createError({ status: 400, statusText: 'Invitation has expired' })
  }

  // Verify the current user may manage the team (`team:manage`, owner/admin by default)
  const membership = await getOrganizationMembershipDirect(result.organizationId, currentUserId)
  if (!membership || !(await can(result.organizationId, currentUserId, 'team:manage', event))) {
    throw createError({ status: 403, statusText: 'Only team admins can resend invitations' })
  }

  // Fire the email hook to resend
  const nitroApp = useNitroApp()
  await nitroApp.hooks.callHook('crouton:auth:email', {
    type: 'invitation',
    to: result.email,
    invitationId: result.id,
    organizationId: result.organizationId,
    organizationName: result.organizationName,
    inviterName: result.inviterName || 'A team member',
    inviterEmail: result.inviterEmail,
    role: result.role,
    expiresAt: new Date(result.expiresAt),
    _event: event,
  })

  return { success: true }
})
