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
import { getAuthInstance, isAuthInitialized } from '../lib/auth'
import { ADMIN_ROLE_NAME, catchUpAdminPermission, readTeamAdminRow, removedOf, type RawDb } from '../lib/team-admin-role'
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
 * Better Auth's context, without ever building the auth instance from a
 * request-less call: with an event, `useServerAuth(event)` (it derives the base
 * URL from the request); without one, only an instance that already exists.
 * Null when there is none yet — the check then uses the static roles.
 */
async function authContext(event?: H3Event) {
  if (event) return await useServerAuth(event).$context
  if (isAuthInitialized()) return await getAuthInstance().$context
  return null
}

/**
 * The roles to check against. `admin` is a row per team (#4130), not a code
 * role: for an admin, read that team's row through `useDB()` (so the answer is
 * the same with or without an auth context), or use the config template while
 * the team has no row yet. The row is caught up with the template at read time
 * (#4283): an action declared since is granted unless the owner removed it.
 * Owner and member never read the extra row.
 */
async function rolesFor(access: CroutonAccessControl, role: string, teamId: string): Promise<Record<string, unknown>> {
  if (!role.split(',').map(r => r.trim()).includes(ADMIN_ROLE_NAME)) return { ...access.roles }
  const row = await readTeamAdminRow(useDB() as unknown as RawDb, teamId)
  if (!row) return { ...access.roles, admin: access.adminTemplateRole }
  const { permission } = catchUpAdminPermission(row.permission, removedOf(row, access), access)
  return { ...access.roles, admin: access.ac.newRole(permission as never) }
}

/**
 * A checker for one member's role, through Better Auth's hasPermission. With an
 * auth context it uses the organization plugin's own options, so per-team roles
 * (when dynamic access control is turned on) load through the same path. Each
 * action is answered once (cached), so `admin:access` reuses the others.
 */
async function roleChecker(access: CroutonAccessControl, role: string, teamId: string, event?: H3Event): Promise<RoleCheck> {
  const ctx = await authContext(event)
  const plugin = (ctx?.options.plugins ?? []).find((p: { id?: string }) => p.id === 'organization') as
    { options?: Record<string, unknown> } | undefined
  // The admin row is per team (#4130): this roles map wins over the plugin's own.
  const options = { ac: access.ac, ...plugin?.options, roles: await rolesFor(access, role, teamId) }
  const answers = new Map<string, Promise<boolean>>()

  return (action: string) => {
    let answer = answers.get(action)
    if (!answer) {
      const parsed = parseAction(action)
      answer = parsed
        ? hasPermission({
            role,
            options: options as never,
            permissions: { [parsed.resource]: [parsed.verb] },
            organizationId: teamId
          }, (ctx ? { context: ctx } : undefined) as never)
        : Promise.resolve(false)
      answers.set(action, answer)
    }
    return answer
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

async function checkMany(teamId: string, userId: string, actions: string[], event?: H3Event): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = Object.fromEntries(actions.map(a => [a, false]))
  if (!teamId || !userId) return result

  const access = resolveAccess()
  const known = actions.filter(a => parseAction(a) && access.actions.includes(a))
  if (known.length === 0) return result

  // One membership read and one checker for every asked action.
  const membership = await getOrganizationMembershipDirect(teamId, userId)
  if (!membership?.role) return result

  const allows = await roleChecker(access, membership.role, teamId, event)
  for (const action of known) {
    result[action] = action === ADMIN_ACCESS_ACTION ? await allowsAdminAccess(access, allows) : await allows(action)
  }
  return result
}

/**
 * Several actions at once: `{ action: boolean }`. Reads the membership once and
 * builds one checker, so asking for many actions costs about the same as one.
 * Pass the request `event` when there is one. Never throws (all false on error).
 */
export async function canMany(teamId: string, userId: string, actions: string[], event?: H3Event): Promise<Record<string, boolean>> {
  try {
    return await checkMany(teamId, userId, actions, event)
  }
  catch (err) {
    console.error(`[crouton/auth] can(${actions.join(',')}) failed — answering false:`, err)
    return Object.fromEntries(actions.map(a => [a, false]))
  }
}

/**
 * Pass the request `event` when there is one. Without it, `can()` never builds
 * the auth instance itself (that would cache it with no request to read the base
 * URL from); it uses the existing instance, or the static roles.
 */
export async function can(teamId: string, userId: string, action: string, event?: H3Event): Promise<boolean> {
  return (await canMany(teamId, userId, [action], event))[action] === true
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
  if (!(await can(context.team.id, context.user.id, action, event))) {
    throw createError({
      status: 403,
      message: `Not allowed: ${action}`
    })
  }
  return context
}
