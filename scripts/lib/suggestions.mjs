// suggestions.mjs — pure helpers for the suggestions log (#4271, epic #4223).
//
// One suggestion = one short line: { ts, source, area, text, evidence }. The CLI
// (scripts/suggest.mjs) validates it here and writes one file per line to the
// `pipeline-data` branch. No I/O and no imports, so it loads on bare Node.

export const AREAS = ['pipeline', 'review', 'gates', 'skills', 'docs', 'status-app', 'deploy', 'tests', 'other']

const MAX_TEXT = 240
const DAY_MS = 24 * 60 * 60 * 1000

const isHttpsUrl = (s) => {
  if (typeof s !== 'string' || !s || /\s/.test(s)) return false
  try { return new URL(s).protocol === 'https:' } catch { return false }
}

const checkTs = (ts) => (typeof ts !== 'string' || Number.isNaN(Date.parse(ts)) ? ['ts must be an ISO date string'] : [])
const checkSource = (s) => (typeof s !== 'string' || !s.trim() ? ['source must be a non-empty string'] : [])
const checkArea = (a) => (AREAS.includes(a) ? [] : [`unknown area "${a}" (one of: ${AREAS.join(', ')})`])

function checkText(text) {
  if (!text) return ['text is required']
  const errors = []
  if (text.length > MAX_TEXT) errors.push(`text is longer than ${MAX_TEXT} characters`)
  if (/[\n\r]/.test(text)) errors.push('text must not contain a newline')
  if (/[.?!]\s+\S/.test(text)) errors.push('text must be one sentence')
  return errors
}

function checkEvidence(ev) {
  if (ev === undefined || ev === null || ev === '') return ['evidence (one https:// URL) is required']
  return isHttpsUrl(ev) ? [] : ['evidence must be one https:// URL']
}

/** Validate one suggestion line. Collects every error. Returns the line with `text` trimmed. */
export function validateSuggestion(line) {
  const l = line && typeof line === 'object' ? line : {}
  const text = typeof l.text === 'string' ? l.text.trim() : ''
  const errors = [...checkTs(l.ts), ...checkSource(l.source), ...checkArea(l.area), ...checkText(text), ...checkEvidence(l.evidence)]
  return { ok: errors.length === 0, errors, line: { ...l, text } }
}

const ageDays = (ts, now) => (now.getTime() - Date.parse(ts)) / DAY_MS

/**
 * True when the line is older than `days` AND no other sighting of the same idea falls
 * within the window. `sightings` = the lines already grouped as the same idea.
 */
export function isExpired(line, sightings = [], now = new Date(), { days = 30 } = {}) {
  if (ageDays(line.ts, now) <= days) return false
  return !sightings.some((s) => s !== line && s.ts !== line.ts && ageDays(s.ts, now) <= days)
}

/** Pick the token + repo for the write. `ghToken`/`ghRepo` are the `gh` CLI results, passed in. */
export function resolveTarget(env = {}, { ghToken = '', ghRepo = '' } = {}) {
  const token = env.DATA_TOKEN || env.GH_TOKEN || env.GITHUB_TOKEN || ghToken || ''
  const repo = env.REPO || env.GITHUB_REPOSITORY || ghRepo || ''
  let error = null
  if (!token) error = 'no token (DATA_TOKEN, GH_TOKEN, GITHUB_TOKEN or gh auth token)'
  else if (!repo) error = 'no repo (REPO, GITHUB_REPOSITORY or gh repo view)'
  return { token, repo, error }
}

/** Default `source` from the environment: worker run → chat name → chat id → unknown. */
export function defaultSource(env = {}) {
  if (env.GITHUB_RUN_ID) return `worker run ${env.GITHUB_RUN_ID}`
  if (env.CROUTON_CHAT_NAME) return env.CROUTON_CHAT_NAME
  if (env.CROUTON_CHAT_ID) return `chat ${env.CROUTON_CHAT_ID}`
  return 'unknown'
}

/** One file per suggestion: suggestions/<YYYY-MM-DD>/<ts>-<rand>.json. */
export function suggestionPath(line, rand) {
  return `suggestions/${line.ts.slice(0, 10)}/${line.ts.replace(/[:.]/g, '-')}-${rand}.json`
}
