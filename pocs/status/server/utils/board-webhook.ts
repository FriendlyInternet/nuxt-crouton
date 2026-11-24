// The webhook's Pipeline-board writer (#4350): one GitHub event → the one board row it touches.
// Reads D1 only (the board rows + the inbox cards for "Waits on you"), never GitHub; rules in
// board-core.ts `boardFromEvent`, writes through the card sync's `applyBoard`. Team + owner as the
// clock finds them (`findOwnerTeam`, NUXT_STATUS_OWNER_EMAIL). Throws on any failure — handleWebhook
// logs it and still answers 202.
import { boardFromEvent, waitingNumbers, type BoardCard, type BoardEvent, type BoardItem, type BoardPlan } from './board-core'

export interface BoardWebhookDeps {
  findOwnerTeam: (email: string) => Promise<{ teamId: string, userId: string } | null>
  rows: (teamId: string) => Promise<BoardItem[]>
  cards: (teamId: string) => Promise<BoardCard[]>
  apply: (plan: BoardPlan, teamId: string, userId: string) => Promise<unknown[]>
}

const defaultDeps = async (): Promise<BoardWebhookDeps> => {
  const [{ findOwnerTeam }, { applyBoard }, items, cards] = await Promise.all([
    import('./cards-sync-clock'),
    import('./cards-sync-run'),
    import('../../layers/pipeline/collections/items/server/database/queries'),
    import('../../layers/inbox/collections/cards/server/database/queries')
  ])
  return {
    findOwnerTeam,
    rows: async teamId => (await items.getAllPipelineItems(teamId)) as unknown as BoardItem[],
    cards: async teamId => (await cards.getAllInboxCards(teamId)) as unknown as BoardCard[],
    apply: applyBoard
  }
}

/** Writes `event` to the owner team's board; returns the plan it applied. Throws when anything failed. */
export async function writeBoardEvent(event: BoardEvent, ownerEmail: string, deps?: BoardWebhookDeps, now: number = Date.now()): Promise<BoardPlan> {
  const d = deps ?? await defaultDeps()
  const owner = await d.findOwnerTeam(ownerEmail)
  if (!owner) throw new Error('owner or team not found (NUXT_STATUS_OWNER_EMAIL)')
  const [existing, cards] = await Promise.all([d.rows(owner.teamId), d.cards(owner.teamId)])
  const plan = boardFromEvent({ event, existing, waiting: waitingNumbers(existing, cards, now), now })
  if (!plan.create.length && !plan.update.length) return plan
  const failures = await d.apply(plan, owner.teamId, owner.userId)
  if (failures.length) throw failures[0] instanceof Error ? failures[0] : new Error(String(failures[0]))
  return plan
}
