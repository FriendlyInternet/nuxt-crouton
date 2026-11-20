/**
 * useTeamRoles — the current team's own roles (#4106)
 *
 * Better Auth dynamic access control: a team role is a name plus ticked crouton
 * actions (stored as Better Auth permissions, see `shared/utils/team-roles.ts`).
 * Used by the Rôles screen (crouton-admin) and the Members role picker.
 *
 * Every call returns `{ data, error }`; `error.code` is Better Auth's error
 * code (e.g. `ROLE_IS_ASSIGNED_TO_MEMBERS`) so the screen can say it plainly.
 * Client-only calls (the auth client only exists in the browser): call
 * `refresh()` from `onMounted` or a handler.
 *
 * @example
 * ```ts
 * const { roles, refresh, create } = useTeamRoles()
 * onMounted(refresh)
 * const { error } = await create('éditeur', ['pages:edit'])
 * ```
 */
import type { Ref, ComputedRef } from 'vue'
import { requireAuthClient } from '../../types/auth-client'
import {
  ADMIN_ROLE,
  BASE_ROLES,
  actionsToRolePermission,
  adminActionsToRolePermission,
  roleEditState,
  rolePermissionToActions,
  validateRoleName
} from '../../shared/utils/team-roles'
import { useTeam } from './useTeam'

export interface TeamRole {
  id: string
  /** Stored (lowercased) name — what a member's `role` holds. */
  role: string
  /** The crouton actions this role has (registered ones only, no `admin:access`). */
  actions: string[]
}

export interface TeamRoleError {
  code?: string
  message: string
}

export interface TeamRoleResult<T = unknown> {
  data: T | null
  error: TeamRoleError | null
}

interface RawRole {
  id: string
  role: string
  permission?: Record<string, string[]> | string | null
}

/** Better Auth client errors carry `code` + `message`; anything else keeps its text. */
function toError(e: unknown): TeamRoleError {
  const err = (e ?? {}) as { code?: string, message?: string }
  return { code: err.code, message: err.message || String(e) }
}

const NO_TEAM: TeamRoleResult<never> = { data: null, error: { message: 'No active team' } }

function fail(e: unknown): TeamRoleResult<never> {
  return { data: null, error: toError(e) }
}

/** Run a call; a thrown error becomes `{ data: null, error }`. */
async function attempt<T>(fn: () => Promise<TeamRoleResult<T>>): Promise<TeamRoleResult<T>> {
  try {
    return await fn()
  }
  catch (e) {
    return fail(e)
  }
}

type ClientResult = { data?: unknown, error?: unknown }

export function useTeamRoles() {
  const { currentTeam } = useTeam()
  const appConfig = useAppConfig() as { croutonActions?: Record<string, { label?: string } | undefined> }

  /** Every registered crouton action except `admin:access` (it comes with any other). */
  const registeredActions: ComputedRef<string[]> = computed(() =>
    Object.keys(appConfig.croutonActions ?? {}).filter(a => a !== 'admin:access' && a.includes(':'))
  )

  /** The team's own roles, without its admin row (that one is `adminRole`). */
  const roles: Ref<TeamRole[]> = useState<TeamRole[]>('crouton-team-roles', () => [])
  /** The team's admin row (#4130): only the owner edits it, nobody deletes it. Null until loaded. */
  const adminRole: Ref<TeamRole | null> = useState<TeamRole | null>('crouton-team-admin-role', () => null)
  /** Which actions the signed-in member holds (and so may give a role). */
  const grantable: Ref<Record<string, boolean>> = useState<Record<string, boolean>>('crouton-team-roles-grantable', () => ({}))
  const loading = ref(false)

  /** Which registered actions the signed-in member holds (#4104's `/can` endpoint). */
  async function fetchGrantable(id: string): Promise<Record<string, boolean>> {
    const actions = registeredActions.value
    if (actions.length === 0) return {}
    return await $fetch<Record<string, boolean>>(`/api/teams/${id}/can`, { query: { actions: actions.join(',') } })
  }

  function toRoles(list: unknown): TeamRole[] {
    return ((list ?? []) as RawRole[]).map(r => ({
      id: r.id,
      role: r.role,
      actions: rolePermissionToActions(r.permission ?? null, registeredActions.value)
    }))
  }

  async function loadRoles(id: string): Promise<TeamRoleResult<TeamRole[]>> {
    const [list, allowed] = await Promise.all([
      requireAuthClient().organization.listRoles({ query: { organizationId: id } }),
      fetchGrantable(id)
    ])
    grantable.value = allowed ?? {}
    if (list.error) return fail(list.error)
    const all = toRoles(list.data)
    adminRole.value = all.find(r => r.role === ADMIN_ROLE) ?? null
    roles.value = all.filter(r => r.role !== ADMIN_ROLE)
    return { data: roles.value, error: null }
  }

  function activeTeamId(): string | null {
    return currentTeam.value?.id ?? null
  }

  async function refresh(): Promise<TeamRoleResult<TeamRole[]>> {
    const id = activeTeamId()
    if (!id) return NO_TEAM
    loading.value = true
    const result = await attempt(() => loadRoles(id))
    loading.value = false
    return result
  }

  /** Run one role change for the current team, then reload the list. */
  async function mutate(call: (organizationId: string) => Promise<ClientResult>): Promise<TeamRoleResult> {
    const id = activeTeamId()
    if (!id) return NO_TEAM
    return await attempt(async () => {
      const res = await call(id)
      if (res.error) return fail(res.error)
      await refresh()
      return { data: res.data, error: null }
    })
  }

  function create(name: string, actions: string[]): Promise<TeamRoleResult> {
    return mutate(organizationId => requireAuthClient().organization.createRole({
      organizationId,
      role: name.trim(),
      permission: actionsToRolePermission(actions)
    }))
  }

  /** Change a role's actions. The name can't change (members hold it by name). */
  function update(name: string, actions: string[]): Promise<TeamRoleResult> {
    return mutate(organizationId => requireAuthClient().organization.updateRole({
      organizationId,
      roleName: name,
      data: { permission: actionsToRolePermission(actions) }
    }))
  }

  /**
   * Change what the team's admins may do (owner only — the server refuses
   * anyone else with `ADMIN_ROLE_OWNER_ONLY`). Admin's own team rights stay.
   */
  function updateAdmin(actions: string[]): Promise<TeamRoleResult> {
    return mutate(organizationId => requireAuthClient().organization.updateRole({
      organizationId,
      roleName: ADMIN_ROLE,
      data: { permission: adminActionsToRolePermission(actions) }
    }))
  }

  /** Delete a role. Better Auth refuses while a member still has it (`ROLE_IS_ASSIGNED_TO_MEMBERS`). */
  function remove(name: string): Promise<TeamRoleResult> {
    return mutate(organizationId => requireAuthClient().organization.deleteRole({ organizationId, roleName: name }))
  }

  return {
    /** owner, admin, member. Owner and member are fixed; admin is `adminRole`. */
    baseRoles: BASE_ROLES,
    /** What the signed-in editor may change on a role (see shared/utils/team-roles). */
    roleEditState,
    /** Check a new role name: the problem, or null. */
    validateRoleName,
    roles,
    adminRole,
    grantable,
    registeredActions,
    loading,
    refresh,
    create,
    update,
    updateAdmin,
    remove
  }
}
