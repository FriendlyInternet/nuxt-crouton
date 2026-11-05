// GitHub API rate-limit classification (#3287). Pure: no I/O.

const header = (e, name) => e?.response?.headers?.[name]

export function isRateLimitError(e) {
  if (!e) return false
  const status = Number(e.status)
  if (status === 429) return true
  if (status === 403) {
    const remaining = header(e, 'x-ratelimit-remaining')
    if (remaining !== undefined && Number(remaining) === 0) return true
    return /rate limit/i.test(e.message || '')
  }
  return false
}

export function rateLimitResetAt(e) {
  const reset = Number(header(e, 'x-ratelimit-reset'))
  if (!Number.isFinite(reset) || reset <= 0) return null
  return new Date(reset * 1000).toISOString()
}

// Rate limit → warn and return (run ends green). Anything else → rethrow unchanged (stays red).
export function deferOrThrow(e, warn) {
  if (isServerError(e)) { // a GitHub 5xx is just as temporary (#3306); the hourly run re-evaluates
    warn(`GitHub server error (HTTP ${e.status}); PR re-evaluated by next hourly run.`)
    return
  }
  if (!isRateLimitError(e)) throw e
  const at = rateLimitResetAt(e)
  warn(`GitHub API rate limit hit${at ? ` (resets ${at})` : ''}; PR re-evaluated by next hourly run.`)
}

// ── API usage per workflow run (#3251) ───────────────────────────────────────────────────────
// `GET /rate_limit` does not count against the allowance. Read it at run start and end; the
// difference is the run's approximate spend (concurrent runs share the allowance).

/**
 * @param {string} token
 * @param {{ fetchImpl?: typeof fetch, apiUrl?: string }} [opts]
 * @returns {Promise<{remaining:number,reset:number,limit:number}|{error:string}>}
 */
// fallow-ignore-next-line complexity -- one guard per rate-limit header/payload shape; covered by rate-limit.test.mjs (#3251)
export async function readRateLimit(token, opts = {}) {
  const f = opts.fetchImpl || globalThis.fetch
  const base = opts.apiUrl || process.env.GITHUB_API_URL || 'https://api.github.com'
  try {
    const res = await f(`${base}/rate_limit`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const body = await res.json()
    const core = body?.resources?.core
    let remaining = Number(core?.remaining)
    let reset = Number(core?.reset)
    let limit = Number(core?.limit)
    if (!Number.isFinite(remaining)) remaining = Number(res.headers?.get?.('x-ratelimit-remaining'))
    if (!Number.isFinite(reset)) reset = Number(res.headers?.get?.('x-ratelimit-reset'))
    if (!Number.isFinite(limit)) limit = Number(res.headers?.get?.('x-ratelimit-limit'))
    if (!Number.isFinite(remaining) || !Number.isFinite(reset)) return { error: 'no rate-limit fields in response' }
    return { remaining, reset, limit: Number.isFinite(limit) ? limit : null }
  } catch (e) {
    return { error: String(e?.message || e) }
  }
}

/**
 * Pure. `api_calls` is start.remaining − end.remaining only when both reads worked and the hourly
 * window did not roll over in between; otherwise null with the reason.
 */
export function diffRateLimit(start, end) {
  if (!start || start.error) return { api_calls: null, reason: 'start-read-failed' }
  if (!end || end.error) return { api_calls: null, reason: 'end-read-failed' }
  if (start.reset !== end.reset) return { api_calls: null, reason: 'reset-window-changed' }
  return { api_calls: Math.max(0, start.remaining - end.remaining), reason: null }
}

// A `gh` process that failed prints the API error on its OWN stderr (#3306). Pure: no I/O.
// Limit shapes: `gh: API rate limit exceeded … (HTTP 403)`, `(HTTP 429)`, `secondary rate limit`.
export function fromGhStderr(text) {
  return /API rate limit exceeded|secondary rate limit|\(HTTP 429\)|HTTP 429\b/i.test(text || '')
}

// Server-side (5xx) failure of the failing call itself. Two `gh` shapes seen in the wild:
// `gh: … (HTTP 502)` (gh api) and `could not create workflow dispatch event: HTTP 500 (…)`.
export function serverErrorFromGhStderr(text) {
  return /\bHTTP 5\d\d\b/.test(text || '')
}

export function isServerError(e) {
  if (!e) return false
  const status = Number(e.status)
  return status >= 500 && status <= 599
}

// The "waiting" note for a PR held by a rate limit (#3306). Marker dedups per reset window.
export function rateLimitNote(e) {
  const at = rateLimitResetAt(e)
  if (!at) {
    return { marker: '<!-- rate-limit-retry -->', body: '🔁 rate-limited by GitHub, retrying on the next hourly check' }
  }
  const reset = Math.floor(new Date(at).getTime() / 1000)
  const hhmm = at.slice(11, 16)
  return {
    marker: `<!-- rate-limit-retry:${reset} -->`,
    body: `🔁 rate-limited by GitHub, retrying on the next hourly check after ${hhmm} UTC`,
  }
}
