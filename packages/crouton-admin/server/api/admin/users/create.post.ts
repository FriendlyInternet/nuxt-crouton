/**
 * Create User API Endpoint
 *
 * POST /api/admin/users/create
 *
 * Creates a new user with the provided details.
 * Requires super admin privileges.
 *
 * Request body:
 * - name: User's display name (required)
 * - email: User's email address (required)
 * - password: User's password (required)
 * - emailVerified: Whether email is verified (default: false)
 * - superAdmin: Whether user is super admin (default: false)
 */
import type { H3Event } from 'h3'
import { defineEventHandler, readBody, createError } from 'h3'
import { eq } from 'drizzle-orm'
import { useNitroApp } from 'nitropack/runtime'
import { user, useAdminDb } from '../../../utils/db'
import { requireSuperAdmin } from '../../../utils/admin'
import type { CreateUserPayload, AdminUser } from '../../../../types/admin'

export default defineEventHandler(async (event: H3Event): Promise<AdminUser> => {
  // Verify super admin access
  const { user: adminUser } = await requireSuperAdmin(event)

  const db = useAdminDb()

  // Parse and validate body
  const body = await readBody<CreateUserPayload>(event)

  if (!body.name?.trim()) {
    throw createError({
      status: 400,
      message: 'Name is required'
    })
  }

  if (!body.email?.trim()) {
    throw createError({
      status: 400,
      message: 'Email is required'
    })
  }

  if (!body.password || body.password.length < 8) {
    throw createError({
      status: 400,
      message: 'Password must be at least 8 characters'
    })
  }

  // Check if email already exists
  const existingUser = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, body.email.toLowerCase()))
    .limit(1)

  if (existingUser.length > 0) {
    throw createError({
      status: 409,
      message: 'A user with this email already exists'
    })
  }

  // Delegate user creation to Better Auth so it owns password hashing
  const auth = useServerAuth(event)
  const signUpResult = await auth.api.signUpEmail({
    // Forward the admin's session so invite-only sign-up lets super admins through
    headers: event.headers,
    body: {
      name: body.name.trim(),
      email: body.email.toLowerCase().trim(),
      password: body.password
    }
  })

  if (!signUpResult?.user?.id) {
    throw createError({ status: 500, message: 'Failed to create user' })
  }

  const userId = signUpResult.user.id

  // Apply admin-only fields that signUpEmail doesn't accept
  const needsUpdate = (body.emailVerified ?? false) || (body.superAdmin ?? false)
  if (needsUpdate) {
    await db.update(user)
      .set({
        emailVerified: body.emailVerified ?? false,
        superAdmin: body.superAdmin ?? false
      })
      .where(eq(user.id, userId))
  }

  // Fetch and return created user
  const createdUsers = await db
    .select()
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  const createdUser = createdUsers[0]

  try {
    await useNitroApp().hooks.callHook('crouton:operation', {
      type: 'admin:user:created',
      source: 'crouton-admin',
      userId: adminUser.id,
      metadata: { targetUserId: createdUser.id, email: createdUser.email }
    })
  } catch { /* non-blocking */ }

  return {
    id: createdUser.id,
    name: createdUser.name,
    email: createdUser.email,
    emailVerified: createdUser.emailVerified,
    image: createdUser.image,
    createdAt: createdUser.createdAt,
    updatedAt: createdUser.updatedAt,
    stripeCustomerId: createdUser.stripeCustomerId,
    superAdmin: createdUser.superAdmin,
    banned: createdUser.banned,
    bannedReason: createdUser.bannedReason,
    bannedUntil: createdUser.bannedUntil
  }
})
