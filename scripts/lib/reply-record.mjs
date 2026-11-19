// A machine-readable "reply record" on a held bot question (#4113).
//
// The record says which replies the question accepts and what each one starts, as one hidden
// line in the comment's leading marker block:
//
//   <!-- reply-record:v1 {"kind":"plan-question","question":"…","accepts":["ok","other"],"starts":{…}} -->
//
// Only the top block of hidden lines counts (see marker.mjs, #3359): a record quoted later in the
// body, inside a `> ` quote or a code block, is ignored. Only bot comments are read.
//
// A `worker-question` record (#4192) sits on the worker's build question, posted by
// scripts/lib/worker-question.mjs; the owner's first answer starts `answer-worker` (a revision).
//
// The router (comment-route.mjs) reads a reply against the open record once (`openRecord` +
// `readReply`, #4145) and passes on what it starts; the re-plan step follows that. `openRecordAt`
// also gives the record's comment index, for the receipt (#4207).
import { leadingMarkers, markerValue } from './marker.mjs'
import { parseOverride, isOwnerVoice } from './decision-line.mjs'
import { isApproval, isBareApproval } from '../approval.mjs'

/** A plan-review verdict marker (moved here from plan-hold.mjs so plan-hold can import openRecord without a cycle). */
export const VERDICT = /<!--\s*plan-review-verdict:(go|no-go|needs-owner)\s*-->/

// `ok: <reason>` is an approval with a reason (the #3041 override), never a bare `ok`.
const OK_REASON = /^[ \t\r\n]*ok[ \t]*:/i

export const RECORD_PREFIX = '<!-- reply-record:v1 '
const SUFFIX = ' -->'

/** PURE. One-line marker for `record`. No `>` and no `--` survive inside the JSON, so the only `-->` is the end. */
export function recordMarker(record) {
  const json = JSON.stringify(record).replace(/>/g, '\\u003e').replace(/--/g, '-\\u002d')
  return `${RECORD_PREFIX}${json}${SUFFIX}`
}

/** PURE. The record in `body`'s leading marker block, or null (missing, bad JSON, not a plain object). */
export function readRecord(body) {
  const line = leadingMarkers(body).find((l) => l.startsWith(RECORD_PREFIX) && l.endsWith(SUFFIX))
  if (!line) return null
  try {
    const v = JSON.parse(line.slice(RECORD_PREFIX.length, line.length - SUFFIX.length))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

const isBot = (c) => c?.userType === 'Bot' || c?.user?.type === 'Bot'

/** PURE. The record of the newest bot comment that carries one, or null. A comment with no type is not read. */
export function newestRecord(comments) {
  const list = Array.isArray(comments) ? comments : []
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]
    if (!isBot(c)) continue
    const r = readRecord(c?.body)
    if (r) return r
  }
  return null
}

const isHuman = (c) => c?.userType === 'User' || c?.user?.type === 'User'
const labelNames = (labels) => (Array.isArray(labels) ? labels : []).map((l) => (typeof l === 'string' ? l : l?.name))

/** `{ body, userType, userLogin }` from a comment in either shape (flat, or the REST `user` object). */
const who = (c) => ({ body: c?.body, userType: c?.userType ?? c?.user?.type, userLogin: c?.userLogin ?? c?.user?.login })

/**
 * PURE. The record a reply answers right now (#4145), or null. Only while the issue is held
 * (`status:blocked`). Walks newest → oldest; the first comment that is a plan-review verdict
 * (the same non-human filter `isPlanHold` uses) or a bot comment carrying a `worker-question`
 * record (#4192) decides:
 * - a verdict: its record when written by a bot and the plan is not approved (`plan:approved`
 *   ends plan questions), else null. A record on an older verdict is stale.
 * - a worker question: its record until the owner has answered it — any comment after it, other
 *   than the newest one (the reply being routed), that is the owner speaking (`isOwnerVoice`:
 *   typed, or relayed by a chat) closes it. A chat's status note neither answers nor closes it.
 * @param {{comments?: object[], labels?: Array<string|{name:string}>, owner?: string}} input
 */
export const openRecord = (input) => openRecordAt(input)?.record ?? null

/**
 * PURE. Same as `openRecord`, plus the index in `comments` of the comment carrying the record
 * (#4207, the reply receipt): `{ record, index }`, or null whenever `openRecord` is null.
 * @param {{comments?: object[], labels?: Array<string|{name:string}>, owner?: string}} input
 * @returns {{record: object, index: number}|null}
 */
export function openRecordAt({ comments, labels, owner } = {}) {
  const names = labelNames(labels)
  if (!names.includes('status:blocked')) return null
  const list = Array.isArray(comments) ? comments : []
  const at = list.findLastIndex((c) => isWorkerQuestion(c) || isVerdict(c))
  if (at < 0) return null
  const c = list[at]
  const open = isWorkerQuestion(c) ? !answeredAfter(list, at, owner) : isBot(c) && !names.includes('plan:approved')
  const record = open ? readRecord(c.body) : null
  return record ? { record, index: at } : null
}

/** A bot comment whose record is a worker's question (#4192). */
const isWorkerQuestion = (c) => isBot(c) && readRecord(c?.body)?.kind === 'worker-question'
/** A plan-review verdict comment (the same non-human filter `isPlanHold` uses). */
const isVerdict = (c) => !isHuman(c) && Boolean(markerValue(c?.body || '', VERDICT))
/** Did the owner speak after `at`, not counting the newest comment (the reply being routed)? */
const answeredAfter = (list, at, owner) => list.slice(at + 1, -1).some((x) => isOwnerVoice(who(x), owner))

const FORMS = {
  'ok: <reason>': (c) => parseOverride(c) !== null,
  ok: (c) => isBareApproval(c.body) && !OK_REASON.test(c.body),
  approval: (c) => isApproval(c.body),
}

/**
 * PURE. Which accepted form a reply is, and what it starts (#4145). Walks `record.accepts` in
 * order. On a `plan-rejected` record an approval or an `ok:`-shaped reply is never `other`
 * (today's isPlanHold does not re-plan it): `{ form: null, starts: null }`. On a
 * `worker-question` record only the owner speaking (`isOwnerVoice`) is read at all (#4192).
 * @param {object|null} record
 * @param {{body?: string, userLogin?: string, owner?: string, userType?: string}} comment
 * @returns {{form: string|null, starts: string|null}}
 */
export function readReply(record, comment = {}) {
  const c = { body: String(comment?.body || ''), userLogin: comment?.userLogin, owner: comment?.owner, userType: comment?.userType }
  if (!record || !Array.isArray(record.accepts)) return { form: 'other', starts: null }
  // A worker's question is answered only by the owner speaking (#4192): a chat's status note is not.
  if (record.kind === 'worker-question' && !isOwnerVoice(c, c.owner)) return { form: null, starts: null }
  for (const form of record.accepts) {
    if (form === 'other') {
      if (record.kind === 'plan-rejected' && (isApproval(c.body) || OK_REASON.test(c.body))) return { form: null, starts: null }
    } else if (!FORMS[form]?.(c)) continue
    return { form, starts: record.starts?.[form] ?? null }
  }
  return { form: null, starts: null }
}
