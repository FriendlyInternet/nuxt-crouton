/**
 * Crouton actions → Better Auth access control (#4104)
 *
 * Packages declare the actions they guard (`croutonActions` in their
 * `app/app.config.ts`, e.g. `{ 'pages:edit': { label: 'pages.permissions.edit' } }`).
 * A site sets which base role gets which action (`croutonAuth.teams.roles`).
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
 * The fallback: actions crouton-auth itself needs registered even when no
 * layer's `croutonActions` is passed in (e.g. `createAuth()` called without
 * `access`). `team:manage` is the action the owner can never lose, and
 * `admin:access` is the one `can()` gives its own meaning. Every other action
 * is declared by the package that guards it, in its `croutonActions`.
 */
export const CROUTON_DEFAULT_ACTIONS = [
  ADMIN_ACCESS_ACTION,
  OWNER_LOCKED_ACTION
] as const

const BASE_ROLE_NAMES: readonly BaseRole[] = ['owner', 'admin', 'member']

/**
 * Better Auth's own organization permissions (invite, change role, …). A crouton
 * action with one of these names would also grant the native endpoint, so they
 * are reserved.
 */
function isReservedAction(action: string): boolean {
  const parsed = parseAction(action)
  if (!parsed) return false
  const verbs = (defaultStatements as Record<string, readonly string[]>)[parsed.resource]
  return !!verbs?.includes(parsed.verb)
}

/**
 * Startup check: no package may declare an action that is one of Better Auth's
 * own organization permissions (e.g. `member:create`). Throws a clear message.
 */
export function validateActions(registry?: CroutonActionRegistry | null): void {
  for (const action of Object.keys(registry ?? {})) {
    if (isReservedAction(action)) {
      throw new Error(`[crouton/auth] croutonActions '${action}' is a Better Auth organization permission — pick another name`)
    }
  }
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
 * role's default list; a role left out keeps its default. Defaults: owner and
 * admin get every registered action (so a newly declared one too), member none.
 */
function resolveBaseRoles(config: BaseRolesConfig | null | undefined, registered: readonly string[]): Record<BaseRole, string[]> {
  return {
    owner: [...(config?.owner ?? registered)],
    admin: [...(config?.admin ?? registered)],
    member: [...(config?.member ?? [])]
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
    if (!BASE_ROLE_NAMES.includes(role as BaseRole)) {
      throw new Error(`[crouton/auth] teams.roles.${role} is not a base role (use owner, admin or member)`)
    }
    if (actions !== undefined && !Array.isArray(actions)) {
      throw new Error(`[crouton/auth] teams.roles.${role} must be a list of actions`)
    }
  }
  const owner = resolveBaseRoles(config, CROUTON_DEFAULT_ACTIONS).owner
  if (!owner.includes(OWNER_LOCKED_ACTION)) {
    throw new Error(`[crouton/auth] teams.roles.owner must include '${OWNER_LOCKED_ACTION}' — the owner can never lose it`)
  }
}

export interface BuildAccessControlInput {
  /** Merged `croutonActions` registry (every layer's app.config). */
  actions?: CroutonActionRegistry | null
  /** Site base roles (`croutonAuth.teams.roles`). */
  roles?: BaseRolesConfig | null
}

type AccessRole = ReturnType<ReturnType<typeof createAccessControl>['newRole']>

/** The roles defined in code. `admin` is not one of them: it is a row per team (#4130). */
export type CodeRole = Exclude<BaseRole, 'admin'>

export interface CroutonAccessControl {
  /** Better Auth access control: its default statements + crouton actions. */
  ac: ReturnType<typeof createAccessControl>
  /**
   * Better Auth roles defined in code: `owner` and `member`, each with its own
   * statements + its crouton actions. `admin` is left out on purpose (#4130):
   * each team stores its own `admin` row (`organizationRole`), seeded from
   * `adminTemplate`, so the team's owner can take actions away from it.
   */
  roles: Record<CodeRole, AccessRole>
  /** The crouton actions a team's admin row starts with (`teams.roles.admin`, default every action). */
  adminTemplate: string[]
  /** The admin role `can()` answers with while a team has no admin row yet. */
  adminTemplateRole: AccessRole
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
  validateActions(input.actions)

  const registered = new Set<string>(CROUTON_DEFAULT_ACTIONS)
  for (const a of Object.keys(input.actions ?? {})) if (parseAction(a)) registered.add(a)
  const actions = [...registered]
  const baseRoles = resolveBaseRoles(input.roles, actions)

  const ac = createAccessControl(mergeStatements(defaultStatements, actionsToStatements(actions)))

  const statementsFor = (role: BaseRole) =>
    mergeStatements(BASE_ROLE_STATEMENTS[role], actionsToStatements(baseRoles[role].filter(a => registered.has(a))))

  const roles = {
    owner: ac.newRole(statementsFor('owner') as never),
    member: ac.newRole(statementsFor('member') as never)
  } as CroutonAccessControl['roles']
  const adminTemplate = baseRoles.admin.filter(a => registered.has(a))
  const adminTemplateRole = ac.newRole(statementsFor('admin') as never)

  return { ac, roles, adminTemplate, adminTemplateRole, actions, baseRoles }
}

/**
 * The permission map a team's fresh `admin` row holds: Better Auth's own admin
 * rights (invite, change role, manage roles, update the team, sub-teams) plus
 * the template's crouton actions (#4130).
 */
export function adminRolePermission(access: Pick<CroutonAccessControl, 'adminTemplate'>): Record<string, string[]> {
  return mergeStatements(adminAc.statements, actionsToStatements(access.adminTemplate))
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
