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
  if (!isRateLimitError(e)) throw e
  const at = rateLimitResetAt(e)
  warn(`GitHub API rate limit hit${at ? ` (resets ${at})` : ''}; PR re-evaluated by next hourly run.`)
}
