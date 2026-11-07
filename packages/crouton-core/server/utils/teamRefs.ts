import { and, eq, inArray } from 'drizzle-orm'

export interface TeamRef {
  /** Body field name (used in the error message) */
  field: string
  /** Drizzle table of the referenced collection (must have `id` and `teamId`) */
  table: any
  /** Value from the request body: id, array of ids, or empty */
  value: unknown
}

/**
 * Assert every referenced record belongs to `teamId` (#3378).
 *
 * Without this a client can POST/PATCH a reference id from another team and the row is stored.
 * "Other team" and "does not exist" share one message so the response doesn't reveal whether
 * another team's id exists. Empty values (undefined/null/'') are skipped — omitted PATCH fields
 * and empty optional references.
 */
export async function assertRefsInTeam(db: any, teamId: string, refs: TeamRef[]): Promise<void> {
  for (const { field, table, value } of refs) {
    if (value === undefined || value === null || value === '') continue

    let ids: string[]
    if (typeof value === 'string') {
      ids = [value]
    } else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
      ids = value.filter(v => v !== '')
    } else {
      throw createError({ status: 400, statusText: `Invalid reference: ${field}` })
    }

    const distinct = [...new Set(ids)]
    if (distinct.length === 0) continue

    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.teamId, teamId), inArray(table.id, distinct)))

    if (rows.length < distinct.length) {
      throw createError({ status: 400, statusText: `Invalid reference: ${field}` })
    }
  }
}
