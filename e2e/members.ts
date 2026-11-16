/**
 * Team-member helper for role-based specs (#3148).
 *
 * The saved e2e user owns the team. To test what a plain `member` may do, the
 * owner invites an extra user through better-auth's organization plugin
 * (POST /api/auth/organization/invite-member, as useTeam.ts calls
 * organization.inviteMember); the invitee signs up with that email and accepts
 * (POST /api/auth/organization/accept-invitation, as useTeam.ts calls
 * organization.acceptInvitation). Each member gets their own APIRequestContext
 * (own cookie jar), already switched to the team.
 */
import { request, type APIRequestContext, type Page } from '@playwright/test'

export interface TeamMember {
  email: string
  ctx: APIRequestContext
}

const PASSWORD = 'TestPassword123!'

/** Invite `email` as a plain member of `teamId` (the page's session must be owner/admin). */
export async function inviteMember(page: Page, base: string, teamId: string, email: string): Promise<string> {
  const res = await page.request.post(`${base}/api/auth/organization/invite-member`, {
    headers: { Origin: base, Referer: `${base}/` },
    data: { email, role: 'member', organizationId: teamId }
  })
  if (!res.ok()) throw new Error(`invite-member failed: ${res.status()} ${await res.text()}`)
  const invitation = await res.json()
  if (!invitation?.id) throw new Error(`invite-member returned no invitation id: ${JSON.stringify(invitation)}`)
  return invitation.id as string
}

/**
 * Create a new user, invite them to the team as `member`, accept, and return a
 * request context signed in as them with the team active. `tag` keeps emails
 * unique per run (the dev DB persists between specs).
 */
export async function addMember(page: Page, base: string, teamId: string, tag: string): Promise<TeamMember> {
  const email = `e2e-member-${tag}-${Date.now()}@example.com`
  const invitationId = await inviteMember(page, base, teamId, email)

  const ctx = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base, Referer: `${base}/` } })
  const signUp = await ctx.post('/api/auth/sign-up/email', { data: { name: `Member ${tag}`, email, password: PASSWORD } })
  if (!signUp.ok()) throw new Error(`member sign-up failed: ${signUp.status()} ${await signUp.text()}`)

  const accept = await ctx.post('/api/auth/organization/accept-invitation', { data: { invitationId } })
  if (!accept.ok()) throw new Error(`accept-invitation failed: ${accept.status()} ${await accept.text()}`)

  const active = await ctx.post('/api/auth/organization/set-active', { data: { organizationId: teamId } })
  if (!active.ok()) throw new Error(`set-active failed: ${active.status()} ${await active.text()}`)

  return { email, ctx }
}
