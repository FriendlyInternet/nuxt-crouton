/**
 * smoke-login.mjs — the retry rule for the deployed smoke's sign-in (#3654).
 *
 * A freshly deployed Worker can answer one sign-in with a 5xx (cold isolate, D1 blip);
 * that one-off turned main red once. So a 5xx or a network error is retried with
 * backoff — the same shape as seed-review-login.mjs (#3474) — while a 4xx (wrong
 * password, 401/403, 429) fails at once, so bad credentials are never hidden.
 * Kept in a lib because smoke-deployed.mjs runs its CLI on import.
 */

export const LOGIN_RETRY_DELAYS_MS = [2000, 5000, 10000]

/** 'ok' | 'retry' | 'give-up' for one sign-in attempt. */
export function loginRetryDecision({ status, threw, attempt, maxAttempts }) {
  if (!threw && status >= 200 && status < 300) return 'ok'
  const transient = !!threw || (status >= 500 && status < 600)
  if (transient && attempt < maxAttempts) return 'retry'
  return 'give-up'
}

/** Delays between attempts; SMOKE_LOGIN_RETRY_DELAYS_MS="ms,ms,…" overrides, garbage → default. */
export function loginRetryDelays(env = process.env) {
  const raw = env.SMOKE_LOGIN_RETRY_DELAYS_MS
  if (raw) {
    const parts = raw.split(',').map(x => x.trim())
    if (parts.every(x => /^\d+$/.test(x))) return parts.map(Number)
  }
  return LOGIN_RETRY_DELAYS_MS
}
