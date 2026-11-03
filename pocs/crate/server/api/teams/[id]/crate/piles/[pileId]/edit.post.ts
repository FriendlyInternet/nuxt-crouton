// Manage one pile (#2211): rename, move (into a pile / up a level), earlier/later, remove.
// Each is ONE undoable step in crate_changes, including the track tags a rename or move rewrites.
import { z } from 'zod'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

const bodySchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename'), name: z.string().min(1).max(200) }),
  z.object({ op: z.literal('move'), parentId: z.string().min(1).nullable() }),
  z.object({ op: z.literal('up') }),
  z.object({ op: z.literal('shift'), dir: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ op: z.literal('remove') })
])

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const { pileId } = getRouterParams(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  const piles = await loadPiles(team.id)
  // Only rename and move rewrite tags, so only they need the whole library's tags.
  const tracks = body.op === 'rename' || body.op === 'move' || body.op === 'up' ? await loadTrackTags(team.id) : []
  let plan
  try {
    plan = body.op === 'rename'
      ? planRename(piles, tracks, pileId!, body.name)
      : body.op === 'move'
        ? planMove(piles, tracks, pileId!, body.parentId)
        : body.op === 'up'
          ? planMoveUp(piles, tracks, pileId!)
          : body.op === 'shift'
            ? planShift(piles, pileId!, body.dir)
            : planRemove(piles, pileId!)
  }
  catch (error) {
    if (error instanceof PileOpError) throw createError({ status: 400, statusText: error.message })
    throw error
  }
  const result = await writeChanges({ teamId: team.id, userId: user.id }, plan, plan.summary)
  return { ...result, summary: plan.summary }
})
