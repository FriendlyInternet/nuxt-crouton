/**
 * Server Auth Utility
 *
 * Provides lazy initialization and access to the Better Auth instance.
 * The auth instance is created on first access since NuxtHub's database
 * binding is only available during request handling.
 *
 * Supports both:
 * - NuxtHub D1 mode: hubDatabase() + drizzle-orm/d1
 * - NuxtHub v0.10+ multi-vendor mode: useDB() (already drizzle instance)
 *
 * @example
 * ```typescript
 * // In an API route
 * export default defineEventHandler(async (event) => {
 *   const auth = useServerAuth(event)
 *   const session = await auth.api.getSession({ headers: event.headers })
 * })
 * ```
 */
import type { H3Event } from 'h3'
import { createError, getRequestURL, getCookie, parseCookies } from 'h3'
import { useRuntimeConfig } from '#imports'
import { eq, and, gt } from 'drizzle-orm'
import { createAuth, isEmailVerificationRequired, type AuthInstance, setAuthInstance, getAuthInstance, isAuthInitialized } from '../lib/auth'
import { session as sessionTable, user as userTable } from '../database/schema/auth'
import type { CroutonAuthConfig } from '../../types/config'
import * as authSchema from '../database/schema/auth'

// NuxtHub v0.10+ provides 'db' from 'hub:db' as an auto-import
declare const db: any

/**
 * Get or create the Better Auth instance
 *
 * Lazily initializes the auth instance on first access.
 * Uses NuxtHub's hubDatabase() to get the D1 binding.
 *
 * @param event - H3 event (needed for database access in NuxtHub)
 * @returns Better Auth instance
 */
export function useServerAuth(event?: H3Event): AuthInstance {
  // Return cached instance if already initialized
  if (isAuthInitialized()) {
    return getAuthInstance()
  }

  // Get runtime config
  const config = useRuntimeConfig()
  const authConfig = config.public?.crouton?.auth as CroutonAuthConfig | undefined

  if (!authConfig) {
    throw new Error(
      '[crouton/auth] No auth configuration found. Add crouton.auth config to nuxt.config.ts'
    )
  }

  // Get secret from runtime config or environment
  const secret = (config.auth as { secret?: string })?.secret || process.env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error(
      '[crouton/auth] BETTER_AUTH_SECRET is required. Set it in your environment variables.'
    )
  }

  // Get base URL - explicit config takes priority, then derive from request
  let baseURL: string | undefined = (config.auth as { baseUrl?: string })?.baseUrl
    || process.env.BETTER_AUTH_URL
    || (config.public?.baseUrl as string | undefined)

  // If no explicit URL configured, derive from the incoming request
  // This handles Cloudflare Pages preview deploys, dynamic ports, and avoids
  // the need to set BETTER_AUTH_URL for every environment
  if (!baseURL && event) {
    const url = getRequestURL(event)
    baseURL = `${url.protocol}//${url.host}`
  }

  if (!baseURL) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[crouton/auth] No BETTER_AUTH_URL set and no request event available. Auth URLs may be incorrect.')
    }
    baseURL = 'http://localhost:3000'
  }

  // Get database instance from NuxtHub v0.10+ (db from hub:db)
  if (typeof db === 'undefined' || db === null) {
    throw new Error('[crouton/auth] No database available. Ensure NuxtHub is configured with hub.db: \'sqlite\' (or \'postgresql\' / \'mysql\')')
  }

  // Create the auth instance
  const auth = createAuth({
    config: authConfig,
    db,
    provider: 'sqlite',
    secret,
    baseURL,
    schema: authSchema,
    // The one place the "can this app send e-mail?" signal is read (#3141):
    // verification is required exactly when crouton-email is installed.
    requireEmailVerification: isEmailVerificationRequired(config)
  })

  // Cache the instance
  setAuthInstance(auth)

  return auth
}

/**
 * Extract session token from request cookies.
 * Better Auth uses different cookie names depending on environment:
 * - Production (HTTPS): __Secure-better-auth.session_token
 * - Development (HTTP):  better-auth.session_token
 */
function extractSessionToken(event: H3Event): string | null {
  const cookies = parseCookies(event)
  // Check all known Better Auth cookie name variants
  const cookieNames = [
    '__Secure-better-auth.session_token', // Cloudflare/HTTPS
    'better-auth.session_token',           // Dev/HTTP
    'better_auth_session',                 // Legacy
  ]
  for (const name of cookieNames) {
    const value = cookies[name]
    if (value) return value
  }
  return null
}

/**
 * Get session from request
 *
 * Uses direct DB query to validate the session token from cookies.
 * This bypasses Better Auth's runWithRequestState requirement which
 * doesn't work on Cloudflare Workers for cross-endpoint API calls.
 *
 * @param event - H3 event
 * @returns Session with user data, or null if not authenticated
 */
export async function getServerSession(event: H3Event) {
  const rawToken = extractSessionToken(event)
  if (!rawToken) return null

  // Better Auth signs cookies as "token.signature" — extract just the token part
  const token = rawToken.includes('.') ? (rawToken.split('.')[0] ?? rawToken) : rawToken

  try {
    const database = useDB()
    const results = await (database as any)
      .select({
        sessionId: sessionTable.id,
        sessionToken: sessionTable.token,
        sessionExpiresAt: sessionTable.expiresAt,
        sessionUserId: sessionTable.userId,
        sessionActiveOrgId: sessionTable.activeOrganizationId,
        userId: userTable.id,
        userName: userTable.name,
        userEmail: userTable.email,
        userEmailVerified: userTable.emailVerified,
        userImage: userTable.image,
        userCreatedAt: userTable.createdAt,
        userUpdatedAt: userTable.updatedAt,
        userRole: userTable.role,
        userBanned: userTable.banned,
        userSuperAdmin: userTable.superAdmin,
        userBannedReason: userTable.bannedReason,
        userBannedUntil: userTable.bannedUntil,
      })
      .from(sessionTable)
      .innerJoin(userTable, eq(sessionTable.userId, userTable.id))
      .where(
        and(
          eq(sessionTable.token, token),
          gt(sessionTable.expiresAt, new Date()),
        ),
      )
      .limit(1)

    if (!results || results.length === 0) return null

    const row = results[0]
    return {
      session: {
        id: row.sessionId,
        token: row.sessionToken,
        userId: row.sessionUserId,
        expiresAt: row.sessionExpiresAt,
        activeOrganizationId: row.sessionActiveOrgId,
      },
      user: {
        id: row.userId,
        name: row.userName,
        email: row.userEmail,
        emailVerified: row.userEmailVerified,
        image: row.userImage,
        createdAt: row.userCreatedAt,
        updatedAt: row.userUpdatedAt,
        role: row.userRole,
        banned: row.userBanned,
        superAdmin: row.userSuperAdmin,
        bannedReason: row.userBannedReason,
        bannedUntil: row.userBannedUntil,
      },
    }
  }
  catch (err) {
    console.error('[crouton/auth] getServerSession DB query failed:', err)
    return null
  }
}

/**
 * Verify the request is authenticated
 *
 * @param event - H3 event
 * @returns Session with user data
 * @throws 401 error if not authenticated
 */
export async function requireServerSession(event: H3Event) {
  const session = await getServerSession(event)

  if (!session?.user) {
    throw createError({
      status: 401,
      message: 'Unauthorized'
    })
  }

  return session
}
