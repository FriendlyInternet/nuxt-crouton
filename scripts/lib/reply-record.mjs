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
// The router (comment-route.mjs) reads a reply against the open record once (`openRecord` +
// `readReply`, #4145) and passes on what it starts; the re-plan step follows that.
import { leadingMarkers, markerValue } from './marker.mjs'
import { parseOverride } from './decision-line.mjs'
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

/**
 * PURE. The record a reply answers right now (#4145), or null. Only while the issue is held
 * (`status:blocked`, no `plan:approved`), and only the record on the NEWEST plan-review verdict
 * comment (the same non-human filter `isPlanHold` uses), written by a bot. A record on an older
 * verdict is stale: records do not close yet, so an old question must not read a new reply.
 * @param {{comments?: object[], labels?: Array<string|{name:string}>}} input
 */
export function openRecord({ comments, labels } = {}) {
  const names = labelNames(labels)
  if (!names.includes('status:blocked') || names.includes('plan:approved')) return null
  const list = Array.isArray(comments) ? comments : []
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]
    if (isHuman(c) || !markerValue(c?.body || '', VERDICT)) continue
    return isBot(c) ? readRecord(c?.body) : null
  }
  return null
}

const FORMS = {
  'ok: <reason>': (c) => parseOverride(c) !== null,
  ok: (c) => isBareApproval(c.body) && !OK_REASON.test(c.body),
  approval: (c) => isApproval(c.body),
}

/**
 * PURE. Which accepted form a reply is, and what it starts (#4145). Walks `record.accepts` in
 * order. On a `plan-rejected` record an approval or an `ok:`-shaped reply is never `other`
 * (today's isPlanHold does not re-plan it): `{ form: null, starts: null }`.
 * @param {object|null} record
 * @param {{body?: string, authorAssociation?: string, userType?: string}} comment
 * @returns {{form: string|null, starts: string|null}}
 */
export function readReply(record, comment = {}) {
  const c = { body: String(comment?.body || ''), authorAssociation: comment?.authorAssociation, userType: comment?.userType }
  if (!record || !Array.isArray(record.accepts)) return { form: 'other', starts: null }
  for (const form of record.accepts) {
    if (form === 'other') {
      if (record.kind === 'plan-rejected' && (isApproval(c.body) || OK_REASON.test(c.body))) return { form: null, starts: null }
    } else if (!FORMS[form]?.(c)) continue
    return { form, starts: record.starts?.[form] ?? null }
  }
  return { form: null, starts: null }
}
