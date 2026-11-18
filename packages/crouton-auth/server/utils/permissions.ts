/**
 * Team permissions — "may this person do this here?" (#4104)
 *
 * One question to ask everywhere: `can(teamId, userId, action)`. The answer
 * comes from Better Auth's `hasPermission`, using the roles crouton built from
 * every package's `croutonActions` and the site's `teams.roles` (see
 * `server/lib/access.ts`). No request session is needed, so it also serves
 * background jobs and token-based callers.
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   const { team } = await requireCan(event, 'pages:edit')
 *   // …
 * })
 * ```
 */
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { useRuntimeConfig, useAppConfig } from '#imports'
import { hasPermission } from 'better-auth/plugins/organization'
import {
  ADMIN_ACCESS_ACTION,
  buildAccessControl,
  getAccessControl,
  parseAction,
  type CroutonAccessControl,
  type CroutonActionRegistry
} from '../lib/access'
import { getOrganizationMembershipDirect, resolveTeamAndCheckMembership, type TeamContext } from './team'
import { useServerAuth } from './useServerAuth'

/** The access control the auth instance was built with (or the same build, if auth is not up yet). */
function resolveAccess(): CroutonAccessControl {
  const built = getAccessControl()
  if (built) return built
  const runtime = useRuntimeConfig() as { public?: { crouton?: { auth?: { teams?: { roles?: Record<string, string[]> } } } } }
  return buildAccessControl({
    actions: (useAppConfig() as { croutonActions?: CroutonActionRegistry }).croutonActions,
    roles: runtime.public?.crouton?.auth?.teams?.roles
  })
}

/**
 * May `userId` do `action` in team `teamId`?
 *
 * - An action no package registered → false.
 * - Not a member of the team → false.
 * - `admin:access` → true when the role has it, or any other crouton action
 *   (so a custom role reaches its screen; Better Auth's own statements don't count).
 * - Never throws: any failure answers false (and is logged).
 */
type RoleCheck = (action: string) => Promise<boolean>

/**
 * A checker for one member's role, through Better Auth's hasPermission. It uses
 * the organization plugin's own options so per-team roles (when dynamic access
 * control is turned on) load through the same path.
 */
async function roleChecker(access: CroutonAccessControl, role: string, teamId: string): Promise<RoleCheck> {
  const ctx = await useServerAuth().$context
  const plugin = (ctx.options.plugins ?? []).find((p: { id?: string }) => p.id === 'organization') as
    { options?: Record<string, unknown> } | undefined
  const options = { ac: access.ac, roles: access.roles, ...plugin?.options }

  return async (action: string) => {
    const parsed = parseAction(action)
    if (!parsed) return false
    return hasPermission({
      role,
      options: options as never,
      permissions: { [parsed.resource]: [parsed.verb] },
      organizationId: teamId
    }, { context: ctx } as never)
  }
}

/** `admin:access`: the role has it, or any other crouton action. */
async function allowsAdminAccess(access: CroutonAccessControl, allows: RoleCheck): Promise<boolean> {
  if (await allows(ADMIN_ACCESS_ACTION)) return true
  for (const other of access.actions) {
    if (other !== ADMIN_ACCESS_ACTION && await allows(other)) return true
  }
  return false
}

async function checkCan(teamId: string, userId: string, action: string): Promise<boolean> {
  if (!teamId || !userId || !parseAction(action)) return false

  const access = resolveAccess()
  if (!access.actions.includes(action)) return false

  const membership = await getOrganizationMembershipDirect(teamId, userId)
  if (!membership?.role) return false

  const allows = await roleChecker(access, membership.role, teamId)
  return action === ADMIN_ACCESS_ACTION ? allowsAdminAccess(access, allows) : allows(action)
}

export async function can(teamId: string, userId: string, action: string): Promise<boolean> {
  try {
    return await checkCan(teamId, userId, action)
  }
  catch (err) {
    console.error(`[crouton/auth] can(${action}) failed — answering false:`, err)
    return false
  }
}

/**
 * Resolve the team from the request (like `requireTeamAdmin`), then 403 unless
 * the signed-in member `can` do `action` there.
 *
 * @returns The team context
 * @throws 401 when not signed in, 403 when not a member or not allowed
 */
export async function requireCan(event: H3Event, action: string): Promise<TeamContext> {
  const context = await resolveTeamAndCheckMembership(event)
  if (!(await can(context.team.id, context.user.id, action))) {
    throw createError({
      status: 403,
      message: `Not allowed: ${action}`
    })
  }
  return context
}
