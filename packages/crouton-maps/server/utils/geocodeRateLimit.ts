/**
 * Per-user geocode limit. In-memory and per-isolate: it bounds abuse from one
 * session on one instance, it is not a global quota.
 */
const WINDOW_MS = 60_000
const MAX_CALLS = 30
const hits = new Map<string, { start: number, count: number }>()

/** True when the call is allowed; false once the user exceeds 30 calls/minute. */
export function allowGeocodeCall(userId: string, now = Date.now()): boolean {
  const entry = hits.get(userId)
  if (!entry || now - entry.start >= WINDOW_MS) {
    if (hits.size > 5000) hits.clear()
    hits.set(userId, { start: now, count: 1 })
    return true
  }
  entry.count++
  return entry.count <= MAX_CALLS
}
