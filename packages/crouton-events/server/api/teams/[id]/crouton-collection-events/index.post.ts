import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { croutonEvents } from '../../../../database/schema'

const OPERATIONS = ['create', 'update', 'delete']
const MAX_CHANGES = 200
const MAX_STR = 10_000

const isStrOrNull = (v: unknown) => v === null || (typeof v === 'string' && v.length <= MAX_STR)

/**
 * Writes one audit entry for the caller's own action. The row is built from an
 * allow-list: identity (team, user, name) and time come from the server, never the body.
 */
export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const db = useDB()
  const body = (await readBody(event)) ?? {}

  if (!OPERATIONS.includes(body.operation)) {
    throw createError({ status: 400, statusText: 'operation must be create, update or delete' })
  }
  if (typeof body.collectionName !== 'string' || typeof body.itemId !== 'string') {
    throw createError({ status: 400, statusText: 'collectionName and itemId are required' })
  }

  const changes = body.changes ?? []
  if (
    !Array.isArray(changes)
    || changes.length > MAX_CHANGES
    || !changes.every((c: any) =>
      c && typeof c === 'object' && typeof c.fieldName === 'string'
      && isStrOrNull(c.oldValue) && isStrOrNull(c.newValue))
  ) {
    throw createError({ status: 400, statusText: 'Invalid changes' })
  }
  const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? body.metadata
    : undefined

  // Same rule as the browser tracker (useCroutonEventTracker).
  const snapshot = (useRuntimeConfig(event).public as any)?.croutonEvents?.snapshotUserName !== false
  const u = user as any
  const userName = snapshot ? (u.name || u.email || 'Unknown User') : ''

  await db.insert(croutonEvents).values({
    id: crypto.randomUUID(),
    timestamp: new Date(),
    operation: body.operation,
    collectionName: body.collectionName,
    itemId: body.itemId,
    changes: changes.map((c: any) => ({ fieldName: c.fieldName, oldValue: c.oldValue, newValue: c.newValue })),
    metadata,
    teamId: team.id,
    userId: user.id,
    userName
  })

  return { success: true }
})
