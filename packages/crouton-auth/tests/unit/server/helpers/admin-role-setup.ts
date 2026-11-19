/**
 * Better Auth and can() on ONE SQLite database (#4130).
 *
 * The other helpers keep Better Auth's store (memory adapter) apart from the
 * SQLite can() reads, so they can't show "the owner edits the admin row → can()
 * sees it". Here Better Auth runs on drizzleAdapter over a better-sqlite3
 * database built from the real fixture migrations, wired the way createAuth()
 * does (real buildOrganizationConfig + buildAuthHooks), and the global `useDB`
 * returns the same database.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import * as authSchema from '../../../../server/database/schema/auth'
import { buildOrganizationConfig, setAuthInstance } from '../../../../server/lib/auth'
import { buildAccessControl, setAccessControl } from '../../../../server/lib/access'
import { buildAuthHooks } from '../../../../server/lib/team-admin-role'
import { DECLARED } from './access-setup'

export const ORIGIN = 'https://velo.pmcp.dev'

const MIGRATIONS = join(__dirname, '../../../../../../fixtures/minimal/server/db/migrations/sqlite')

/** An in-memory SQLite with every table of the fixture app's migrations. */
export function openMigratedDb(): Database.Database {
  const sqlite = new Database(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(join(MIGRATIONS, file), 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement)
    }
  }
  return sqlite
}

export type User = { userId: string, headers: Headers }

/** Better Auth + access control + `useDB` on one SQLite. Close `sqlite` when done. */
export function setupAdminRoleWorld() {
  const sqlite = openMigratedDb()
  const db = drizzle(sqlite, { schema: authSchema })
  vi.stubGlobal('useDB', () => db)
  const access = buildAccessControl({ actions: DECLARED })
  setAccessControl(access)
  const auth = betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    secret: 'test-secret-test-secret-test-secret-123',
    baseURL: ORIGIN,
    emailAndPassword: { enabled: true },
    plugins: [organization(buildOrganizationConfig({}, db as never, access) as never)],
    hooks: buildAuthHooks(access, db as never)
  })
  setAuthInstance(auth as never)

  async function signUp(email: string): Promise<User> {
    const res = await auth.api.signUpEmail({
      body: { email, password: 'correct-horse-battery-staple', name: email.split('@')[0]! },
      returnHeaders: true
    })
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!
    return { userId: res.response.user.id, headers: new Headers({ cookie, origin: ORIGIN }) }
  }

  /** The team's admin rows (there must only ever be one). */
  function adminRows(orgId: string): Array<{ id: string, permission: string }> {
    return sqlite.prepare('SELECT id, permission FROM organizationRole WHERE organizationId = ? AND role = ?').all(orgId, 'admin') as never
  }

  return { sqlite, db, access, auth, signUp, adminRows }
}

/** 'ok', or Better Auth's error code (falls back to the HTTP status name). */
export async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  }
  catch (e) {
    const err = e as { status?: string, body?: { code?: string } }
    return err.body?.code ?? err.status ?? String(e)
  }
}
