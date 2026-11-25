/**
 * Team roles — a team's own roles on top of owner/admin/member (#4106)
 *
 * Better Auth dynamic access control stores a team role as a name plus a
 * permission map (`{ resource: [verb] }`) in `organizationRole`. The roles
 * screen speaks crouton actions (`pages:edit`); this module maps the two ways
 * and checks a role name.
 *
 * Pure — no Nuxt / H3 imports — so client, server and vitest load it as is.
 */

/**
 * The three built-in team roles. None can be created or deleted; owner and
 * member can't be edited, admin only by the team's owner (#4130).
 */
export const BASE_ROLES = ['owner', 'admin', 'member'] as const

export type BaseRoleName = typeof BASE_ROLES[number]

export function isBaseRole(name: unknown): name is BaseRoleName {
  return typeof name === 'string' && (BASE_ROLES as readonly string[]).includes(name.trim().toLowerCase())
}

/** Comes with any other crouton action (computed in can()), so it is never stored. */
const ADMIN_ACCESS = 'admin:access'

/** The crouton action that means "manage the team". */
export const TEAM_MANAGE_ACTION = 'team:manage'

/**
 * Better Auth's own rights a `team:manage` role also gets, so its own endpoints
 * let the member invite, change roles and manage roles (the base admin set).
 */
export const TEAM_MANAGE_NATIVE: Readonly<Record<string, readonly string[]>> = {
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  ac: ['create', 'read', 'update', 'delete']
}

/** The team's admin role: one stored row per team, edited by the owner only (#4130). */
export const ADMIN_ROLE = 'admin'

/**
 * Better Auth's own admin rights that have no checkbox on the roles screen, so
 * the admin row always keeps them: update the team, manage its sub-teams.
 */
export const ADMIN_FIXED_NATIVE: Readonly<Record<string, readonly string[]>> = {
  organization: ['update'],
  team: ['create', 'update', 'delete']
}

/** Longest role name the screen accepts. */
export const ROLE_NAME_MAX = 40

function split(action: string): [string, string] | null {
  const i = action.indexOf(':')
  if (i <= 0 || i === action.length - 1) return null
  return [action.slice(0, i), action.slice(i + 1)]
}

function add(out: Record<string, string[]>, resource: string, verb: string) {
  const verbs = (out[resource] ??= [])
  if (!verbs.includes(verb)) verbs.push(verb)
}

/**
 * Crouton actions → the permission map Better Auth stores for a team role.
 * `admin:access` is dropped (it comes with any other action); `team:manage`
 * also brings Better Auth's member / invitation / ac rights.
 */
export function actionsToRolePermission(actions: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const action of actions) {
    if (action === ADMIN_ACCESS) continue
    const parts = split(action)
    if (!parts) continue
    add(out, parts[0], parts[1])
  }
  if (actions.includes(TEAM_MANAGE_ACTION)) {
    for (const [resource, verbs] of Object.entries(TEAM_MANAGE_NATIVE)) {
      for (const verb of verbs) add(out, resource, verb)
    }
  }
  return out
}

/**
 * Crouton actions → the permission map of the team's admin row (#4130): the
 * same as a custom role (`team:manage` brings member / invitation / ac), plus
 * `ADMIN_FIXED_NATIVE`, which an edit never removes.
 */
export function adminActionsToRolePermission(actions: readonly string[]): Record<string, string[]> {
  const out = actionsToRolePermission(actions)
  for (const [resource, verbs] of Object.entries(ADMIN_FIXED_NATIVE)) {
    for (const verb of verbs) add(out, resource, verb)
  }
  return out
}

/**
 * A stored permission map → the crouton actions it holds, keeping only
 * registered actions (in registry order). Better Auth's own entries
 * (`member:update`, `ac:read`, native `team:update`) are never read back as
 * crouton actions, and `admin:access` is never listed.
 */
export function rolePermissionToActions(
  permission: Record<string, readonly string[] | undefined> | string | null | undefined,
  registered: readonly string[]
): string[] {
  let map: Record<string, readonly string[] | undefined> = {}
  if (typeof permission === 'string') {
    try {
      map = JSON.parse(permission) ?? {}
    }
    catch {
      map = {}
    }
  }
  else if (permission && typeof permission === 'object') {
    map = permission
  }
  return registered.filter((action) => {
    if (action === ADMIN_ACCESS) return false
    const parts = split(action)
    return !!parts && !!map[parts[0]]?.includes(parts[1])
  })
}

export interface RoleEditState {
  /** Registered actions the editor doesn't hold — their checkbox is disabled. */
  lockedActions: string[]
  /** The role already has an action the editor doesn't hold: Better Auth would refuse any save. */
  readOnly: boolean
}

/**
 * What the signed-in editor may change on a role. Better Auth only lets someone
 * save a role whose every right they hold themselves, so actions they lack are
 * locked, and a role holding one of those can't be saved by them at all.
 */
export function roleEditState(roleActions: readonly string[], grantable: Readonly<Record<string, boolean>>): RoleEditState {
  const lockedActions = Object.keys(grantable).filter(a => a !== ADMIN_ACCESS && grantable[a] !== true)
  const readOnly = roleActions.some(a => a !== ADMIN_ACCESS && grantable[a] !== true)
  return { lockedActions, readOnly }
}

export type RoleNameProblem = 'empty' | 'tooLong' | 'comma' | 'base'

/**
 * Check a new role name. Returns the problem, or null when it is fine.
 * Better Auth stores names lowercased and splits a member's roles on `,`.
 */
export function validateRoleName(name: unknown): RoleNameProblem | null {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return 'empty'
  if (trimmed.length > ROLE_NAME_MAX) return 'tooLong'
  if (trimmed.includes(',')) return 'comma'
  if (isBaseRole(trimmed)) return 'base'
  return null
}
