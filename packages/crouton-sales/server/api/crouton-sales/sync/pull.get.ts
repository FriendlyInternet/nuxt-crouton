/**
 * Cloud-side pull for config sync (#815, epic #801).
 *
 * A paired till asks "what changed since my cursor" and gets the config rows and
 * delete markers of its own team. Device-authed exactly like ingest; the
 * deprecated shared key has no team, so it cannot pull.
 *
 * Query: since (epoch ms cursor, default 0), skip (from the previous reply), limit (default 200, max 500)
 * Reply: { changes, cursor, skip, hasMore, serverNow } — send `cursor` and `skip` back.
 */
import { authenticateSync, deviceOf } from '../../../utils/cloud-sync-auth'
import { collectConfigChanges, DEFAULT_PULL_LIMIT } from '../../../utils/sync-pull'

export default defineEventHandler(async (event) => {
  const device = deviceOf(await authenticateSync(event))
  if (!device) {
    throw createError({ status: 403, statusText: 'Config pull needs a paired device' })
  }

  const query = getQuery(event)
  const since = Number(query.since)
  const limit = Number(query.limit)
  const skip = Number(query.skip)
  return collectConfigChanges(
    useDB(),
    device.teamId,
    Number.isFinite(since) && since > 0 ? since : 0,
    {
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : DEFAULT_PULL_LIMIT,
      skip: Number.isFinite(skip) && skip > 0 ? Math.min(skip, 500) : 0,
    },
  )
})
