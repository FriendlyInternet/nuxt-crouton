// A machine-readable "reply record" on a held bot question (#4113).
//
// The record says which replies the question accepts and what each one starts, as one hidden
// line in the comment's leading marker block:
//
//   <!-- reply-record:v1 {"kind":"plan-question","question":"…","accepts":["ok","other"],"starts":{…}} -->
//
// Only the top block of hidden lines counts (see marker.mjs, #3359): a record quoted later in the
// body, inside a `> ` quote or a code block, is ignored. Only bot comments are read.
import { leadingMarkers } from './marker.mjs'

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
