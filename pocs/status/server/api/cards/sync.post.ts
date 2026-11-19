// POST /api/cards/sync — read GitHub live and upsert one inbox card per ask that waits on the owner.
// → { created, updated, stale, answered, stuck: { quiet, draft, epicSync }, throttled?, error?, skipped? }
// A failed save or D1 read never answers 500: it lands in `error`, and the counts cover successful saves only.
// Owner-only. Run by the inbox page on load; the clock runs the same `runCardsSync` at :00/:30
// (server/utils/cards-sync-clock.ts). Skips the GitHub read when the last sync of this team was
// < 60 s ago. The sync itself: server/utils/cards-sync-run.ts.
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { requireStatusOwner, githubToken } from '../../utils/github'
import { NO_STUCK, THROTTLE_MS, cardsSyncThrottleKey, runCardsSync } from '../../utils/cards-sync-run'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const store = useStorage('kv')
  const throttleKey = cardsSyncThrottleKey(team.id)
  const last = Number(await store.getItem(throttleKey)) || 0
  if (Date.now() - last < THROTTLE_MS) return { created: 0, updated: 0, stale: 0, answered: 0, stuck: { ...NO_STUCK }, throttled: true }
  await store.setItem(throttleKey, Date.now())

  // The sync must finish even when the browser leaves (a reload, a closed tab). On Workers a
  // dropped request cancels its unfinished work, and the throttle stamp above holds off the
  // retry for 60 s — so a page reloaded within the ~18 s GitHub read never stored a card and
  // stayed on "Checking GitHub…" (the PR #3991 preview screenshot, #3880).
  const work = runCardsSync({ token: githubToken(event), teamId: team.id, userId: user.id })
  event.waitUntil?.(work.catch(() => {}))
  return await work
})
