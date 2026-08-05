/**
 * Lock out every helper currently logged in to this event: deactivate all of
 * the event's active scoped-access tokens so their sessions die and they must
 * re-enter the PIN.
 *
 * Two callers, one behaviour:
 * - The Helpers card's "Log out all helpers" button (kick everyone now).
 * - SettingsTab's save flow, automatically when the event's `helperPin`
 *   changed — old-PIN helpers can't keep a live session on the new PIN.
 *
 * The new PIN isn't checked here: `salesEvents.helperPin` is the source of
 * truth and the `crouton:scoped-access:before-redeem` hook re-syncs it into
 * the grant on the next login, so a revoked helper's old PIN simply fails to
 * redeem. This only ends the *existing* tokens.
 */
import { revokeScopedTokensForResource } from '@fyit/crouton-auth/server/utils/scoped-access'
import { requireTeamEvent } from '../../../../../../utils/team-event'

export default defineEventHandler(async (event) => {
  // team membership + event-belongs-to-team, in one guard.
  const { eventId } = await requireTeamEvent(event)

  // Event ids are globally-unique nanoids, so resourceType+resourceId can't
  // leak across teams — no org scoping needed.
  const revoked = await revokeScopedTokensForResource('event', eventId)

  return { revoked }
})
