// earlier-owner-ok.mjs — did the owner already say `ok` before this verdict landed? (#3173)
// Pure. Used by build-review.yml to add a "reply ok again" line to a final hold. Approval is
// judged only by approval.mjs (isApproval / isAgentComment); the author must be the owner login.
import { isAgentComment, isApproval } from '../approval.mjs'

const t = (c) => new Date(c.created_at).getTime()

/** created_at of the newest reviewer verdict comment (carries a build-review-sha marker), or null. */
export function lastVerdictAt(comments = []) {
  const v = comments
    .filter(c => c.user?.type === 'Bot' && /<!-- build-review-sha:[0-9a-f]+ -->/.test(c.body || ''))
    .sort((a, b) => t(b) - t(a))[0]
  return v ? v.created_at : null
}

/** True only if the owner's NEWEST comment after `since` is an approval. */
export function earlierOwnerOk({ comments = [], owner, since = null }) {
  const from = since ? new Date(since).getTime() : 0
  const mine = comments
    .filter(c => c.user?.login?.toLowerCase() === String(owner).toLowerCase() && c.user?.type !== 'Bot' && !isAgentComment(c.body) && t(c) > from)
    .sort((a, b) => t(b) - t(a))
  return mine.length > 0 && isApproval(mine[0].body)
}
