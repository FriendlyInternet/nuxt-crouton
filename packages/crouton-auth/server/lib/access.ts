/**
 * Crouton actions → Better Auth access control (#4104)
 *
 * Packages declare the actions they guard (`croutonActions` in their
 * `app/app.config.ts`, e.g. `{ 'pages:edit': { label: 'pages.permissions.edit' } }`).
 * A site sets which base role gets which action (`crouton.auth.teams.roles`).
 * This module turns both into Better Auth's `ac` + `roles`, so the organization
 * plugin and `can()` answer from the same definition.
 *
 * Pure: no Nuxt / Nitro imports, so it is unit-testable as is.
 */
import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access'

/** The three built-in team roles. */
export type BaseRole = 'owner' | 'admin' | 'member'

/** A registered crouton action (`resource:verb`, e.g. `pages:edit`). */
export interface CroutonActionDefinition {
  /** i18n key for the action's label (shown on the roles screen). */
  label?: string
}

/** `croutonActions` registry shape (merged across every layer's app.config). */
export type CroutonActionRegistry = Record<string, CroutonActionDefinition | undefined>

/** Site config shape: base role → the crouton actions it gets. */
export type BaseRolesConfig = Partial<Record<BaseRole, string[]>>

/** The action that unlocks the admin area; also granted by any other crouton action. */
export const ADMIN_ACCESS_ACTION = 'admin:access'

/** The action the owner can never lose. */
const OWNER_LOCKED_ACTION = 'team:manage'

/**
 * Every action crouton packages guard today (the #4104 table). Owner and
 * admin get them all by default; member gets none.
 *
 * These are always registered, even when the owning package has not (yet)
 * declared them in its `croutonActions`, so `can()` matches today's rights
 * on every site. Packages add labels and any new actions via `croutonActions`.
 */
export const CROUTON_DEFAULT_ACTIONS = [
  'admin:access',
  'team:manage',
  'team:domains',
  'site:manage',
  'collections:manage',
  'translations:manage',
  'pages:edit',
  'media:manage',
  'activity:view',
  'bookings:create',
  'bookings:manage',
  'sales:manage'
] as const

/** Defaults when the site sets no `teams.roles`. */
const DEFAULT_BASE_ROLES: Record<BaseRole, readonly string[]> = {
  owner: CROUTON_DEFAULT_ACTIONS,
  admin: CROUTON_DEFAULT_ACTIONS,
  member: []
}

const BASE_ROLE_STATEMENTS: Record<BaseRole, Record<string, readonly string[]>> = {
  owner: ownerAc.statements,
  admin: adminAc.statements,
  member: memberAc.statements
}

/** Split `resource:verb`. Returns null for anything else. */
export function parseAction(action: unknown): { resource: string, verb: string } | null {
  if (typeof action !== 'string') return null
  const i = action.indexOf(':')
  if (i <= 0 || i === action.length - 1) return null
  return { resource: action.slice(0, i), verb: action.slice(i + 1) }
}

/** Join two statement maps per resource (never replace a resource's list). */
function mergeStatements(
  a: Record<string, readonly string[]>,
  b: Record<string, readonly string[]>
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [res, verbs] of Object.entries(a)) out[res] = [...verbs]
  for (const [res, verbs] of Object.entries(b)) {
    out[res] = [...new Set([...(out[res] ?? []), ...verbs])]
  }
  return out
}

function actionsToStatements(actions: Iterable<string>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const action of actions) {
    const parsed = parseAction(action)
    if (!parsed) continue
    const verbs = (out[parsed.resource] ??= [])
    if (!verbs.includes(parsed.verb)) verbs.push(parsed.verb)
  }
  return out
}

/**
 * Resolve the site's base roles: a role listed in the config replaces that
 * role's default list; a role left out keeps its default.
 */
function resolveBaseRoles(config?: BaseRolesConfig | null): Record<BaseRole, string[]> {
  return {
    owner: [...(config?.owner ?? DEFAULT_BASE_ROLES.owner)],
    admin: [...(config?.admin ?? DEFAULT_BASE_ROLES.admin)],
    member: [...(config?.member ?? DEFAULT_BASE_ROLES.member)]
  }
}

/**
 * Startup check: the owner must keep `team:manage`, or nobody could ever
 * manage the team again. Throws a clear message otherwise.
 */
export function validateBaseRoles(config?: BaseRolesConfig | null): void {
  if (config == null) return
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('[crouton/auth] teams.roles must be an object of base role → actions, e.g. { member: [\'pages:edit\'] }')
  }
  for (const [role, actions] of Object.entries(config)) {
    if (!(role in DEFAULT_BASE_ROLES)) {
      throw new Error(`[crouton/auth] teams.roles.${role} is not a base role (use owner, admin or member)`)
    }
    if (actions !== undefined && !Array.isArray(actions)) {
      throw new Error(`[crouton/auth] teams.roles.${role} must be a list of actions`)
    }
  }
  const owner = resolveBaseRoles(config).owner
  if (!owner.includes(OWNER_LOCKED_ACTION)) {
    throw new Error(`[crouton/auth] teams.roles.owner must include '${OWNER_LOCKED_ACTION}' — the owner can never lose it`)
  }
}

export interface BuildAccessControlInput {
  /** Merged `croutonActions` registry (every layer's app.config). */
  actions?: CroutonActionRegistry | null
  /** Site base roles (`crouton.auth.teams.roles`). */
  roles?: BaseRolesConfig | null
}

export interface CroutonAccessControl {
  /** Better Auth access control: its default statements + crouton actions. */
  ac: ReturnType<typeof createAccessControl>
  /** Better Auth roles: each base role's own statements + its crouton actions. */
  roles: Record<BaseRole, ReturnType<ReturnType<typeof createAccessControl>['newRole']>>
  /** Registered crouton action ids. */
  actions: string[]
  /** Resolved base role → crouton actions. */
  baseRoles: Record<BaseRole, string[]>
}

/**
 * Build Better Auth's `ac` + `roles` from the registered crouton actions and the
 * site's base roles. A base role only gets actions that some package registered;
 * Better Auth's own statements (invite, change role, …) are kept per resource.
 */
export function buildAccessControl(input: BuildAccessControlInput = {}): CroutonAccessControl {
  validateBaseRoles(input.roles)

  const registered = new Set<string>(CROUTON_DEFAULT_ACTIONS)
  for (const a of Object.keys(input.actions ?? {})) if (parseAction(a)) registered.add(a)
  const actions = [...registered]
  const baseRoles = resolveBaseRoles(input.roles)

  const ac = createAccessControl(mergeStatements(defaultStatements, actionsToStatements(actions)))

  const roles = {} as CroutonAccessControl['roles']
  for (const role of Object.keys(baseRoles) as BaseRole[]) {
    const own = baseRoles[role].filter(a => registered.has(a))
    roles[role] = ac.newRole(mergeStatements(BASE_ROLE_STATEMENTS[role], actionsToStatements(own)) as never)
  }

  return { ac, roles, actions, baseRoles }
}

// ----------------------------------------------------------------------------
// Process-wide holder (set when the auth instance is created)
// ----------------------------------------------------------------------------

let _access: CroutonAccessControl | null = null

export function setAccessControl(access: CroutonAccessControl | null): void {
  _access = access
}

export function getAccessControl(): CroutonAccessControl | null {
  return _access
}
