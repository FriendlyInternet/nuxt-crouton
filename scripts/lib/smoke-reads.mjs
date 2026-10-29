/**
 * smoke-reads.mjs — the `smoke.reads` step runner for smoke-deployed.mjs (#3077).
 * Pure: HTTP and team lookup are injected so it is unit-testable without a network.
 *
 * Each entry is one authenticated GET against the deployed app:
 *   { path, expectStatus?: 200 | number[], expectIncludes? }
 * A miss (wrong status, or the body lacks `expectIncludes`) is a failure. `{teamId}` is the
 * logged-in session's active team, as for `smoke.crud`. This is how a package endpoint the app
 * consumes (e.g. sync-status) gets exercised on the real Worker, not just a single CRUD route.
 */
import { fillPlaceholders, bodyExcerpt } from './smoke-crud.mjs'

/**
 * @param {Array<{path:string, expectStatus?:number|number[], expectIncludes?:string}>} reads
 * @param {object} deps  { http(method, path, body, {auth}) → {res:{status}, text}, getTeamId(), log(msg) }
 * @returns {Promise<string[]>} failure messages (empty = pass)
 */
export async function runReads(reads, { http, getTeamId, log = () => {} }) {
  if (!Array.isArray(reads) || !reads.length) return []
  const vars = {}
  if (JSON.stringify(reads).includes('{teamId}')) {
    vars.teamId = await getTeamId()
    if (!vars.teamId) return ['reads: a path uses {teamId} but the session has no active team']
  }
  const failures = []
  for (const r of reads) {
    const path = fillPlaceholders(r.path, vars)
    try {
      const { res, text } = await http('GET', path, undefined, { auth: true })
      const failure = checkRead(r, path, res, text, vars)
      if (failure) failures.push(failure)
      else log(`✓ reads ${path} → ${res.status}`)
    } catch (e) { failures.push(`reads ${path}: ${e.message}`) }
  }
  return failures
}

/** One response against its entry: a failure message, or null when it passes. */
function checkRead(r, path, res, text, vars) {
  const wantAny = [].concat(r.expectStatus ?? 200)
  if (!wantAny.includes(res.status)) {
    return `reads ${path}: HTTP ${res.status}, expected ${wantAny.join('|')}${bodyExcerpt(text)}`
  }
  const expect = r.expectIncludes == null ? null : fillPlaceholders(r.expectIncludes, vars)
  if (expect && !String(text ?? '').includes(expect)) return `reads ${path}: missing "${expect}"`
  return null
}
