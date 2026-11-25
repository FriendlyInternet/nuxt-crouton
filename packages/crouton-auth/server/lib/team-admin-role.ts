/**
 * The team's admin role — one row per team that only the owner edits (#4130)
 *
 * `owner` and `member` are defined in code (`access.roles`). `admin` is not:
 * each team stores its own `admin` row in `organizationRole` (Better Auth
 * dynamic access control), so the team's owner can take actions away from
 * that team's admins without touching any other team. This module:
 *
 * - seeds that row (`ensureTeamAdminRole`);
 * - keeps it current (`syncTeamAdminRole`, #4283): an action declared later
 *   reaches the row, unless this team's owner removed it (`removedActions`);
 * - reads it back for `can()` (`readTeamAdminRow`), caught up the same way;
 * - guards it (`buildAuthHooks`): only an owner edits it, nobody renames or
 *   deletes it, and no other role may be named `admin`. Better Auth itself
 *   would let an admin shrink the row, or anyone delete it by id.
 *
 * The rows start from `teams.roles.admin` (the template, see `access.ts`).
 */
import { sql } from 'drizzle-orm'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { rolePermissionToActions, actionsToRolePermission } from '../../shared/utils/team-roles'
import { ADMIN_ACCESS_ACTION, adminRolePermission, type CroutonAccessControl } from './access'

/** The stored name of the team's admin role. */
export const ADMIN_ROLE_NAME = 'admin'

/** The raw-SQL part of crouton's db the helpers need (D1 in production, better-sqlite3 in tests). */
export type RawDb = Pick<DrizzleD1Database<Record<string, unknown>>, 'run' | 'all'>

type Access = Pick<CroutonAccessControl, 'adminTemplate' | 'actions'>

function normalize(name: unknown): string | null {
  return typeof name === 'string' && name.trim() ? name.trim().toLowerCase() : null
}

/**
 * Give the team its admin row when it has none. One atomic statement
 * (`INSERT … SELECT … WHERE NOT EXISTS`), so parallel calls still leave one row.
 * Safe to call on every request; it writes only the first time.
 */
export async function ensureTeamAdminRole(db: RawDb | null | undefined, orgId: string | null | undefined, access: Access | null | undefined): Promise<void> {
  if (!db || !orgId || !access) return
  const permission = JSON.stringify(adminRolePermission(access))
  // `createdAt` is integer `mode: 'timestamp'` (epoch seconds), as drizzle writes it.
  const now = Math.floor(Date.now() / 1000)
  // A fresh row is the whole template, so nothing is removed yet (`'[]'`, a literal
  // so the bound params stay id, orgId, permission, now).
  await db.run(sql`INSERT INTO organizationRole (id, organizationId, role, permission, removedActions, createdAt) SELECT ${crypto.randomUUID()}, ${orgId}, 'admin', ${permission}, '[]', ${now} WHERE NOT EXISTS (SELECT 1 FROM organizationRole WHERE organizationId = ${orgId} AND role = 'admin')`)
}

/**
 * The same seed, logged instead of thrown: a team must never fail to be created
 * over its admin row (the first `/organization/*` call seeds it anyway).
 */
export async function seedTeamAdminRole(db: RawDb | null | undefined, orgId: string | null | undefined, access: Access | null | undefined): Promise<void> {
  try {
    await ensureTeamAdminRole(db, orgId, access)
  }
  catch (err) {
    console.error(`[crouton/auth] Could not seed the admin role of team ${orgId}:`, err)
  }
}

// ----------------------------------------------------------------------------
// Keeping the row current (#4283)
// ----------------------------------------------------------------------------

type PermissionMap = Record<string, string[]>

function parseMap(permission: PermissionMap | string | null | undefined): PermissionMap {
  if (permission && typeof permission === 'object') return permission
  if (typeof permission !== 'string') return {}
  try {
    const parsed = JSON.parse(permission)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as PermissionMap : {}
  }
  catch {
    return {}
  }
}

/**
 * The template actions an admin row lacks — what the team's owner left
 * unticked. `admin:access` is never stored, so never counted.
 */
function removedFrom(permission: PermissionMap | string | null | undefined, access: Access): string[] {
  const held = new Set(rolePermissionToActions(parseMap(permission), access.actions))
  return access.adminTemplate.filter(a => a !== ADMIN_ACCESS_ACTION && !held.has(a))
}

/**
 * The stored `removedActions` text → the list, or null when it is not recorded
 * (NULL, or anything that is not a JSON array of strings).
 */
function parseRemoved(text: string | null | undefined): string[] | null {
  if (typeof text !== 'string') return null
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) && parsed.every(a => typeof a === 'string') ? parsed : null
  }
  catch {
    return null
  }
}

/**
 * The admin row caught up with the template: every template action the row
 * lacks and the owner did not remove is added (`team:manage` brings its
 * native rights). Never takes anything away. Nothing to add → the same map.
 */
export function catchUpAdminPermission(
  permission: PermissionMap | string | null | undefined,
  removed: readonly string[],
  access: Access
): { permission: PermissionMap, added: string[] } {
  const map = parseMap(permission)
  const held = new Set(rolePermissionToActions(map, access.actions))
  const skip = new Set(removed)
  const added = access.adminTemplate.filter(a => a !== ADMIN_ACCESS_ACTION && !skip.has(a) && !held.has(a))
  if (added.length === 0) return { permission: map, added }
  const out: PermissionMap = {}
  for (const [res, verbs] of Object.entries(map)) out[res] = [...verbs]
  for (const [res, verbs] of Object.entries(actionsToRolePermission(added))) {
    out[res] = [...new Set([...(out[res] ?? []), ...verbs])]
  }
  return { permission: out, added }
}

interface AdminRow { id: string, permission: string, removedActions: string | null }

async function readRow(db: RawDb, orgId: string): Promise<AdminRow | null> {
  const rows = await db.all<AdminRow>(sql`SELECT id, permission, removedActions FROM organizationRole WHERE organizationId = ${orgId} AND role = 'admin' LIMIT 1`)
  return rows[0] ?? null
}

/**
 * The team's stored admin row (`permission` parsed), or null when it has no
 * row yet (or the table can't be read — `can()` then answers from the template).
 */
export async function readTeamAdminRow(db: RawDb | null | undefined, orgId: string): Promise<{ permission: PermissionMap, removedActions: string | null } | null> {
  if (!db || !orgId) return null
  try {
    const row = await readRow(db, orgId)
    if (!row?.permission) return null
    const parsed = JSON.parse(row.permission)
    if (!parsed || typeof parsed !== 'object') return null
    return { permission: parsed as PermissionMap, removedActions: row.removedActions ?? null }
  }
  catch {
    return null
  }
}

/** What the owner removed: the recorded list, or (a row from before #4283) every template action it lacks. */
export function removedOf(row: { permission: PermissionMap | string, removedActions: string | null }, access: Access): string[] {
  return parseRemoved(row.removedActions) ?? removedFrom(row.permission, access)
}

/**
 * Bring the team's admin row up to date with the template: add every action
 * declared since, except the ones the owner removed. A row with no
 * `removedActions` yet records what it lacks as removed (backfill). One
 * compare-and-swap UPDATE (`WHERE permission = <what was read>`), so an owner
 * save landing in between is never overwritten. Logged, never thrown.
 */
export async function syncTeamAdminRole(db: RawDb | null | undefined, orgId: string | null | undefined, access: Access | null | undefined): Promise<void> {
  if (!db || !orgId || !access) return
  try {
    const row = await readRow(db, orgId)
    if (!row) return
    const removed = removedOf(row, access)
    const { permission, added } = catchUpAdminPermission(row.permission, removed, access)
    if (added.length === 0 && row.removedActions !== null) return
    const now = Math.floor(Date.now() / 1000)
    await db.run(sql`UPDATE organizationRole SET permission = ${JSON.stringify(permission)}, removedActions = ${JSON.stringify(removed)}, updatedAt = ${now} WHERE id = ${row.id} AND permission = ${row.permission}`)
  }
  catch (err) {
    console.error(`[crouton/auth] Could not sync the admin role of team ${orgId}:`, err)
  }
}

/** After the owner saved the admin row: record what they left unticked. */
async function recordRemoved(db: RawDb, orgId: string, access: Access): Promise<void> {
  try {
    const row = await readRow(db, orgId)
    if (!row) return
    await db.run(sql`UPDATE organizationRole SET removedActions = ${JSON.stringify(removedFrom(row.permission, access))} WHERE id = ${row.id}`)
  }
  catch (err) {
    console.error(`[crouton/auth] Could not record the removed admin actions of team ${orgId}:`, err)
  }
}

/**
 * The team whose admin row a call should find seeded. Read calls
 * (`list-roles`, `get-role`) name it in the query, as Better Auth reads it
 * there; write calls in the body. Used for the seed only — seeding writes
 * nothing but the template, and only when the team has no row — never for
 * the guard (see `orgOf`).
 */
async function seedOrgOf(ctx: HookCtx): Promise<string | null> {
  const fromBody = ctx.body?.organizationId
  if (typeof fromBody === 'string' && fromBody) return fromBody
  const fromQuery = ctx.query?.organizationId
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery
  return (await sessionOf(ctx))?.session?.activeOrganizationId ?? null
}

// ----------------------------------------------------------------------------
// The guard (Better Auth global `hooks.before`)
// ----------------------------------------------------------------------------

interface Adapter {
  findOne<T>(input: { model: string, where: Array<{ field: string, value: unknown }> }): Promise<T | null>
}

interface HookCtx {
  path?: string
  body?: Record<string, unknown> | null
  query?: Record<string, unknown> | null
  headers?: Headers
  context: { adapter: Adapter, returned?: unknown }
}

async function sessionOf(ctx: HookCtx) {
  if (!ctx.headers) return null
  return await getSessionFromCtx(ctx as never).catch(() => null) as
    { user: { id: string }, session: { activeOrganizationId?: string | null } } | null
}

/**
 * The team a call is about, resolved exactly as Better Auth's role endpoints
 * do: `body.organizationId ?? session.activeOrganizationId`. Never the URL
 * query — Better Auth ignores it, so trusting it would let a caller point the
 * guard at another team than the one the call changes.
 */
async function orgOf(ctx: HookCtx): Promise<string | null> {
  const fromBody = ctx.body?.organizationId
  if (typeof fromBody === 'string' && fromBody) return fromBody
  return (await sessionOf(ctx))?.session?.activeOrganizationId ?? null
}

/**
 * The role an update-role / delete-role call targets: `roleName` first (as
 * Better Auth does), else the stored name of `roleId`. Null when neither
 * resolves (Better Auth then answers ROLE_NOT_FOUND itself).
 */
async function resolveTargetRole(ctx: HookCtx, orgId: string | null): Promise<string | null> {
  const byName = normalize(ctx.body?.roleName)
  if (byName) return byName
  const roleId = ctx.body?.roleId
  if (typeof roleId !== 'string' || !roleId) return null
  const where = [{ field: 'id', value: roleId }]
  if (orgId) where.push({ field: 'organizationId', value: orgId })
  const row = await ctx.context.adapter.findOne<{ role?: string }>({ model: 'organizationRole', where })
  return normalize(row?.role)
}

async function callerIsOwner(ctx: HookCtx, orgId: string | null): Promise<boolean> {
  const session = await sessionOf(ctx)
  const org = orgId ?? session?.session?.activeOrganizationId
  if (!session?.user?.id || !org) return false
  const member = await ctx.context.adapter.findOne<{ role?: string }>({
    model: 'member',
    where: [{ field: 'organizationId', value: org }, { field: 'userId', value: session.user.id }]
  })
  return (member?.role ?? '').split(',').map(r => r.trim()).includes('owner')
}

function refuse(status: 'FORBIDDEN' | 'BAD_REQUEST', code: string, message: string): never {
  throw new APIError(status, { code, message })
}

/** create-role: only the seed writes a role named admin. */
async function guardCreate(ctx: HookCtx): Promise<void> {
  if (normalize(ctx.body?.role) === ADMIN_ROLE_NAME) {
    refuse('BAD_REQUEST', 'ROLE_NAME_IS_ALREADY_TAKEN', 'The admin role already exists')
  }
}

/** delete-role: the admin row is never deleted, by name or by id. */
async function guardDelete(ctx: HookCtx, orgId: string | null): Promise<void> {
  if (await resolveTargetRole(ctx, orgId) === ADMIN_ROLE_NAME) {
    refuse('FORBIDDEN', 'ADMIN_ROLE_CANNOT_BE_DELETED', 'The admin role cannot be deleted')
  }
}

/** update-role on the admin row: never renamed; only an owner changes it. */
async function guardAdminUpdate(ctx: HookCtx, orgId: string | null, newName: unknown): Promise<void> {
  // Renamed away, the team would have no admin row (and the seed would bring back a full one).
  if (newName !== undefined && newName !== null) {
    refuse('BAD_REQUEST', 'ADMIN_ROLE_CANNOT_BE_RENAMED', 'The admin role cannot be renamed')
  }
  if (!await callerIsOwner(ctx, orgId)) {
    refuse('FORBIDDEN', 'ADMIN_ROLE_OWNER_ONLY', 'Only the owner can change the admin role')
  }
}

/** update-role: the admin row is guarded; no other role may be renamed to admin. */
async function guardUpdate(ctx: HookCtx, orgId: string | null): Promise<void> {
  const newName = ((ctx.body?.data ?? {}) as Record<string, unknown>).roleName
  if (await resolveTargetRole(ctx, orgId) === ADMIN_ROLE_NAME) return guardAdminUpdate(ctx, orgId, newName)
  if (normalize(newName) === ADMIN_ROLE_NAME) {
    refuse('BAD_REQUEST', 'ROLE_NAME_IS_ALREADY_TAKEN', 'The admin role already exists')
  }
}

const ROLE_GUARDS: Record<string, (ctx: HookCtx, orgId: string | null) => Promise<void>> = {
  '/organization/create-role': guardCreate,
  '/organization/delete-role': guardDelete,
  '/organization/update-role': guardUpdate
}

async function guardRoleCall(ctx: HookCtx, orgId: string | null): Promise<void> {
  const guard = ctx.path ? ROLE_GUARDS[ctx.path] : undefined
  if (guard) await guard(ctx, orgId)
}

/**
 * Better Auth's global `hooks` for `createAuth` (#4130). On every
 * `/organization/*` call: give the team its admin row when it has none (teams
 * made outside the four creation paths, e.g. the content seed) and bring it up
 * to date with the template (`syncTeamAdminRole`, #4283), then guard the
 * role endpoints. After a successful admin `update-role`, record what the owner
 * left unticked (`removedActions`). The seed is the single conditional INSERT in
 * `ensureTeamAdminRole` — there is no read-then-create path. Without `db`
 * (tests on a memory adapter) nothing is seeded: those tests seed the row
 * themselves; the guard still runs.
 */
export function buildAuthHooks(access: Access, db?: RawDb | null) {
  return {
    before: createAuthMiddleware(async (raw) => {
      const ctx = raw as unknown as HookCtx
      if (!ctx.path?.startsWith('/organization/')) return
      const orgId = await orgOf(ctx)
      // A failed seed (e.g. an unknown team id) never fails the call: Better Auth answers it.
      const seedOrg = db ? await seedOrgOf(ctx) : null
      if (seedOrg && db) {
        await seedTeamAdminRole(db, seedOrg, access)
        await syncTeamAdminRole(db, seedOrg, access)
      }
      await guardRoleCall(ctx, orgId)
    }),
    // After a successful save of the admin row (only an owner gets this far),
    // record what was left unticked. After hooks also run on errors: skip those.
    after: createAuthMiddleware(async (raw) => {
      const ctx = raw as unknown as HookCtx
      if (ctx.path !== '/organization/update-role' || !db) return
      if (ctx.context.returned instanceof APIError || ctx.context.returned instanceof Error) return
      const orgId = await orgOf(ctx)
      if (!orgId || await resolveTargetRole(ctx, orgId) !== ADMIN_ROLE_NAME) return
      await recordRemoved(db, orgId, access)
    })
  }
}
