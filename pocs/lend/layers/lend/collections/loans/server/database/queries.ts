// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { LendLoan, NewLendLoan } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllLendLoans(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllLendLoans(teamId: string, opts?: {}): Promise<any[]>
export async function getAllLendLoans(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.lendLoans.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.lendLoans,
      ownerUser: {
        id: ownerUser.id,
        name: ownerUser.name,
        email: ownerUser.email,
        image: ownerUser.image
      },
      createdByUser: {
        id: createdByUser.id,
        name: createdByUser.name,
        email: createdByUser.email,
        image: createdByUser.image
      },
      updatedByUser: {
        id: updatedByUser.id,
        name: updatedByUser.name,
        email: updatedByUser.email,
        image: updatedByUser.image
      }
    } as any)
    .from(tables.lendLoans)
    .leftJoin(ownerUser, eq(tables.lendLoans.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.lendLoans.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.lendLoans.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.lendLoans.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const loans = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.lendLoans)
      .where(whereExpr)
    return { items: loans, total: Number(countRow?.count ?? 0) }
  }

  return loans
}

export async function getLendLoansByIds(teamId: string, loanIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const loans = await (db as any)
    .select({
      ...tables.lendLoans,
      ownerUser: {
        id: ownerUser.id,
        name: ownerUser.name,
        email: ownerUser.email,
        image: ownerUser.image
      },
      createdByUser: {
        id: createdByUser.id,
        name: createdByUser.name,
        email: createdByUser.email,
        image: createdByUser.image
      },
      updatedByUser: {
        id: updatedByUser.id,
        name: updatedByUser.name,
        email: updatedByUser.email,
        image: updatedByUser.image
      }
    } as any)
    .from(tables.lendLoans)
    .leftJoin(ownerUser, eq(tables.lendLoans.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.lendLoans.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.lendLoans.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.lendLoans.teamId, teamId),
        inArray(tables.lendLoans.id, loanIds)
      )
    )
    .orderBy(desc(tables.lendLoans.createdAt))

  return loans
}

export async function createLendLoan(data: NewLendLoan) {
  const db = useDB()

  const [loan] = await (db as any)
    .insert(tables.lendLoans)
    .values(data)
    .returning()

  return loan
}

export async function updateLendLoan(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<LendLoan>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.lendLoans.id, recordId),
    eq(tables.lendLoans.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.lendLoans.owner, userId))
  }

  const [loan] = await (db as any)
    .update(tables.lendLoans)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!loan) {
    throw createError({
      status: 404,
      statusText: 'LendLoan not found or unauthorized'
    })
  }

  return loan
}

export async function deleteLendLoan(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.lendLoans.id, recordId),
    eq(tables.lendLoans.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.lendLoans.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.lendLoans)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'LendLoan not found or unauthorized'
    })
  }

  return { success: true }
}