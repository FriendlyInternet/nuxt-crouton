/**
 * The team's admin role — one row per team that only the owner edits (#4130)
 *
 * `owner` and `member` are defined in code (`access.roles`). `admin` is not:
 * each team stores its own `admin` row in `organizationRole` (Better Auth
 * dynamic access control), so the team's owner can take actions away from
 * that team's admins without touching any other team. This module:
 *
 * - seeds that row (`ensureTeamAdminRole`) — the only code that writes it;
 * - reads it back for `can()` (`readTeamAdminRole`);
 * - guards it (`buildAuthHooks`): only an owner edits it, nobody renames or
 *   deletes it, and no other role may be named `admin`. Better Auth itself
 *   would let an admin shrink the row, or anyone delete it by id.
 *
 * The rows start from `teams.roles.admin` (the template, see `access.ts`).
 */
import { sql } from 'drizzle-orm'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { adminRolePermission, type CroutonAccessControl } from './access'

/** The stored name of the team's admin role. */
export const ADMIN_ROLE_NAME = 'admin'

/** The raw-SQL part of crouton's db the helpers need (D1 in production, better-sqlite3 in tests). */
export type RawDb = Pick<DrizzleD1Database<Record<string, unknown>>, 'run' | 'all'>

type Access = Pick<CroutonAccessControl, 'adminTemplate'>

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
  await db.run(sql`INSERT INTO organizationRole (id, organizationId, role, permission, createdAt) SELECT ${crypto.randomUUID()}, ${orgId}, 'admin', ${permission}, ${now} WHERE NOT EXISTS (SELECT 1 FROM organizationRole WHERE organizationId = ${orgId} AND role = 'admin')`)
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

/**
 * The team's stored admin permission map, or null when it has no row yet (or
 * the table can't be read — `can()` then answers from the template).
 */
export async function readTeamAdminRole(db: RawDb | null | undefined, orgId: string): Promise<Record<string, string[]> | null> {
  if (!db || !orgId) return null
  try {
    const rows = await db.all<{ permission: string }>(sql`SELECT permission FROM organizationRole WHERE organizationId = ${orgId} AND role = 'admin' LIMIT 1`)
    const raw = rows[0]?.permission
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string[]> : null
  }
  catch {
    return null
  }
}

// ----------------------------------------------------------------------------
// The guard (Better Auth global `hooks.before`)
// ----------------------------------------------------------------------------

interface Adapter {
  findOne<T>(input: { model: string, where: Array<{ field: string, value: unknown }> }): Promise<T | null>
  create<T>(input: { model: string, data: Record<string, unknown> }): Promise<T>
}

interface HookCtx {
  path?: string
  body?: Record<string, unknown> | null
  query?: Record<string, unknown> | null
  headers?: Headers
  context: { adapter: Adapter }
}

/** Without crouton's raw db (tests on a memory adapter): read-then-create through Better Auth's adapter. */
async function ensureViaAdapter(adapter: Adapter, orgId: string, access: Access): Promise<void> {
  const existing = await adapter.findOne({
    model: 'organizationRole',
    where: [{ field: 'organizationId', value: orgId }, { field: 'role', value: ADMIN_ROLE_NAME }]
  })
  if (existing) return
  await adapter.create({
    model: 'organizationRole',
    data: { organizationId: orgId, role: ADMIN_ROLE_NAME, permission: JSON.stringify(adminRolePermission(access)), createdAt: new Date() }
  })
}

async function sessionOf(ctx: HookCtx) {
  if (!ctx.headers) return null
  return await getSessionFromCtx(ctx as never).catch(() => null) as
    { user: { id: string }, session: { activeOrganizationId?: string | null } } | null
}

/** The team a call is about: the body, then the query, then the caller's active team. */
async function orgOf(ctx: HookCtx): Promise<string | null> {
  const fromBody = ctx.body?.organizationId
  if (typeof fromBody === 'string' && fromBody) return fromBody
  const fromQuery = ctx.query?.organizationId
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery
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
 * made outside the four creation paths, e.g. the content seed), then guard the
 * role endpoints. Without `db` (tests on a memory adapter) the seed goes
 * through Better Auth's adapter instead.
 */
export function buildAuthHooks(access: Access, db?: RawDb | null) {
  return {
    before: createAuthMiddleware(async (raw) => {
      const ctx = raw as unknown as HookCtx
      if (!ctx.path?.startsWith('/organization/')) return
      const orgId = await orgOf(ctx)
      // A failed seed (e.g. an unknown team id) never fails the call: Better Auth answers it.
      if (orgId) {
        if (db) await seedTeamAdminRole(db, orgId, access)
        else await ensureViaAdapter(ctx.context.adapter, orgId, access).catch(() => {})
      }
      await guardRoleCall(ctx, orgId)
    })
  }
}
