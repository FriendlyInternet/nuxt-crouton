// GET /api/status/board — the Pipeline tab (#4349): the team's `pipeline_items`, each in the column
// `stageOf` gives NOW from the current waiting inbox cards (so "Waits on you" follows the inbox without
// a row write). Owner-only. Reads D1 only — never GitHub; the card sync writes the rows.
// → { data: BoardRow[] | null, error }
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { requireStatusOwner } from '../../utils/github'
import { boardView, type BoardCard, type BoardItem, type BoardRow } from '../../utils/board-core'
import { getAllPipelineItems } from '../../../layers/pipeline/collections/items/server/database/queries'
import { getAllInboxCards } from '../../../layers/inbox/collections/cards/server/database/queries'

export default defineEventHandler(async (event): Promise<{ data: BoardRow[] | null, error: string | null }> => {
  await requireStatusOwner(event)
  const { team } = await resolveTeamAndCheckMembership(event)
  try {
    const [rows, cards] = await Promise.all([getAllPipelineItems(team.id), getAllInboxCards(team.id)])
    return { data: boardView(rows as unknown as BoardItem[], cards as unknown as BoardCard[]), error: null }
  } catch (e) {
    console.error('[status/board]', e)
    return { data: null, error: `Could not read the board: ${e instanceof Error ? e.message : String(e)}` }
  }
})
