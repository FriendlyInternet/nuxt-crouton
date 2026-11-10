import { eq, and, desc, inArray } from 'drizzle-orm'
import { croutonRedirects } from '../schema/redirects'
import type { CroutonRedirect, NewCroutonRedirect } from '../../../types/redirects'

export async function getAllCroutonRedirects(teamId: string) {
  const db = useDB()

  return db
    .select()
    .from(croutonRedirects)
    .where(eq(croutonRedirects.teamId, teamId))
    .orderBy(desc(croutonRedirects.createdAt))
}

export async function getCroutonRedirectsByIds(teamId: string, ids: string[]) {
  const db = useDB()

  return db
    .select()
    .from(croutonRedirects)
    .where(
      and(
        eq(croutonRedirects.teamId, teamId),
        inArray(croutonRedirects.id, ids)
      )
    )
    .orderBy(desc(croutonRedirects.createdAt))
}

export async function getActiveCroutonRedirects() {
  const db = useDB()

  return db
    .select({
      teamId: croutonRedirects.teamId,
      fromPath: croutonRedirects.fromPath,
      toPath: croutonRedirects.toPath,
      statusCode: croutonRedirects.statusCode
    })
    .from(croutonRedirects)
    .where(eq(croutonRedirects.isActive, true))
}

export async function createCroutonRedirect(data: NewCroutonRedirect) {
  const db = useDB()

  const [redirect] = await db
    .insert(croutonRedirects)
    .values(data)
    .returning()

  return redirect
}

export async function updateCroutonRedirect(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<CroutonRedirect>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(croutonRedirects.id, recordId),
    eq(croutonRedirects.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(croutonRedirects.owner, userId))
  }

  const [redirect] = await db
    .update(croutonRedirects)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!redirect) {
    throw createError({
      status: 404,
      statusText: 'Redirect not found or unauthorized'
    })
  }

  return redirect
}

export async function deleteCroutonRedirect(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(croutonRedirects.id, recordId),
    eq(croutonRedirects.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(croutonRedirects.owner, userId))
  }

  const [deleted] = await db
    .delete(croutonRedirects)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'Redirect not found or unauthorized'
    })
  }

  return { success: true }
}
