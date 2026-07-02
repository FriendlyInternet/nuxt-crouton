// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { SalesClient, NewSalesClient } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllSalesClients(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllSalesClients(teamId: string, opts?: {}): Promise<any[]>
export async function getAllSalesClients(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.salesClients.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.salesClients,
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
    .from(tables.salesClients)
    .leftJoin(ownerUser, eq(tables.salesClients.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesClients.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesClients.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.salesClients.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const clients = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.salesClients)
      .where(whereExpr)
    return { items: clients, total: Number(countRow?.count ?? 0) }
  }

  return clients
}

export async function getSalesClientsByIds(teamId: string, clientIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const clients = await (db as any)
    .select({
      ...tables.salesClients,
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
    .from(tables.salesClients)
    .leftJoin(ownerUser, eq(tables.salesClients.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesClients.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesClients.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.salesClients.teamId, teamId),
        inArray(tables.salesClients.id, clientIds)
      )
    )
    .orderBy(desc(tables.salesClients.createdAt))

  return clients
}

export async function createSalesClient(data: NewSalesClient) {
  const db = useDB()

  const [client] = await (db as any)
    .insert(tables.salesClients)
    .values(data)
    .returning()

  return client
}

export async function updateSalesClient(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<SalesClient>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesClients.id, recordId),
    eq(tables.salesClients.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesClients.owner, userId))
  }

  const [client] = await (db as any)
    .update(tables.salesClients)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!client) {
    throw createError({
      status: 404,
      statusText: 'SalesClient not found or unauthorized'
    })
  }

  return client
}

export async function deleteSalesClient(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesClients.id, recordId),
    eq(tables.salesClients.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesClients.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.salesClients)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'SalesClient not found or unauthorized'
    })
  }

  return { success: true }
}