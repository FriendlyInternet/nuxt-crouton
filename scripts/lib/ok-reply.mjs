// ok-reply.mjs — what to tell the owner when their `ok` can't merge yet (#3173). Pure.
// One tested place decides every reply; the workflows only gather facts and post the text.
const TEXT = {
  pending: "Your `ok` is noted, but the build review for the latest commit hasn't posted yet — it will count once the review is in.",
  round1: 'Your `ok` is noted, but this build was only sent back to the worker (round 1). It needs the worker to push a fix; your `ok` will count if the review rejects it a second time and holds it for you.',
  failed: 'Your `ok` is noted, but the build review failed to run for the latest commit — re-run the review and your `ok` will count once it has posted.',
  'ok-again': 'Your earlier `ok` came before this verdict — reply `ok` again to merge as is.',
}

/**
 * @param {{ state?: {kind: string}, ownerOk: boolean, okBeforeFinal?: boolean }} input
 * @returns {{ reason: string, text: string } | null}
 */
export function chooseOkReply({ state, ownerOk, okBeforeFinal = false }) {
  if (!ownerOk) return null
  const kind = state?.kind
  if (kind === 'final' || kind === 'needs-owner') return okBeforeFinal ? { reason: 'ok-again', text: TEXT['ok-again'] } : null
  if (kind === 'pending' || kind === 'round1' || kind === 'failed') return { reason: kind, text: TEXT[kind] }
  return null
}
