/**
 * Console guard — the pure matcher behind the e2e "no silent blank spots" check (#2916).
 *
 * Vue doesn't crash when a component is looked up by name and isn't there: it logs a
 * dev-only warning and draws nothing. The smoke opens every screen but never read the
 * console, so a blank spot passed. The fixture in helpers.ts collects console warnings/
 * errors + uncaught page errors and hands them to `evaluate`; only patterns on the list
 * fail a test. Kept CommonJS so Playwright specs (CJS) and node:test can both load it.
 */

/** Console patterns that FAIL a test. Add the next one as one line, with its reason. */
const CONSOLE_FAIL_PATTERNS = [
  {
    pattern: '[Vue warn]: Failed to resolve component',
    reason: 'a component looked up by name is missing, so a piece renders as a blank spot'
  }
]

/**
 * @param {{ type: string, text: string, url: string }[]} messages console messages + page errors
 *   (`type` is the Playwright console type, or 'pageerror')
 * @param {{ pattern: string, reason: string }[]} [allow] per-fixture accepted warnings (manifest `allowConsole`)
 * @param {{ pattern: string, reason: string }[]} [patterns] override the fail list (tests)
 * @returns {{ message: string, url: string, reason: string }[]} the failures
 */
function evaluate(messages, allow = [], patterns = CONSOLE_FAIL_PATTERNS) {
  const failures = []
  for (const m of messages) {
    if (allow.some(a => m.text.includes(a.pattern))) continue
    if (m.type === 'pageerror') {
      failures.push({ message: m.text, url: m.url, reason: 'uncaught page error' })
      continue
    }
    if (m.type !== 'warning' && m.type !== 'error') continue
    const hit = patterns.find(p => m.text.includes(p.pattern))
    if (hit) failures.push({ message: m.text, url: m.url, reason: hit.reason })
  }
  return failures
}

/** Readable multi-line failure message naming each match and its page. */
function formatFailures(failures) {
  return failures.map(f => `  ${f.message}\n    on ${f.url} — ${f.reason}`).join('\n')
}

module.exports = { CONSOLE_FAIL_PATTERNS, evaluate, formatFailures }
