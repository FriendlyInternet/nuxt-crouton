/**
 * smoke-crud.mjs — the `smoke.crud` step runner for smoke-deployed.mjs (#2764).
 * Pure: HTTP and team lookup are injected so it is unit-testable without a network.
 *
 * Steps, in order (all but `create` optional):
 *   create → update (PATCH) → read (authenticated GET) → readPublic (anonymous GET) → delete
 * Placeholders in paths, bodies and `expectIncludes`:
 *   {id}     the new record's id (from `idFrom`)
 *   {teamId} the logged-in session's active team
 *   {rand}   a per-run token, so create/update values are unique and checkable
 * `delete` is always attempted once `create` worked, even when a middle step failed.
 */

export function dotGet(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
}

/** Replace {id}/{teamId}/{rand} in every string of a value (deep). */
export function fillPlaceholders(value, vars) {
  if (typeof value === 'string') {
    return value.replace(/\{(id|teamId|rand)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])))
  }
  if (Array.isArray(value)) return value.map(v => fillPlaceholders(v, vars))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillPlaceholders(v, vars)]))
  }
  return value
}

/** First 500 chars of a failing response body, for the failure line (#2812); '' when there is none. */
export function bodyExcerpt(text) {
  const t = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : ''
  return t ? ` — ${t.slice(0, 500)}` : ''
}

/** One GET/PATCH step: pushes a failure and returns false when it is not ok or misses `expectIncludes`. */
async function runStep(name, step, { auth, method = 'GET', body }, { http, fill, failures }) {
  const { res, json, text } = await http(method, fill(step.path), body, { auth })
  const expect = step.expectIncludes == null ? null : fill(step.expectIncludes)
  if (res.ok && !(expect && !JSON.stringify(json ?? '').includes(expect))) return true
  failures.push(`crud.${name}: HTTP ${res.status}${expect ? ` / missing "${expect}"` : ''}${res.ok ? '' : bodyExcerpt(text)}`)
  return false
}

/** update → read → readPublic, each logged on success. */
async function runChecks(crud, ctx) {
  const { fill, log } = ctx
  const u = crud.update
  const steps = [
    u && ['update', u, { auth: true, method: u.method || 'PATCH', body: fill(u.body ?? {}) }, '✓ crud.update ok'],
    crud.read && ['read', crud.read, { auth: true }, '✓ crud.read ok — saved record reads back'],
    crud.readPublic && ['readPublic', crud.readPublic, { auth: false }, '✓ crud.readPublic ok — created record is publicly readable'],
  ].filter(Boolean)
  for (const [name, step, opts, okMsg] of steps) {
    if (await runStep(name, step, opts, ctx)) log(okMsg)
  }
}

async function runDelete(d, id, { http, fill, failures, log }) {
  try {
    const { res, text } = await http(d.method || 'DELETE', fill(d.path), undefined, { auth: true })
    if (res.ok) log('✓ crud.delete ok')
    else failures.push(`crud.delete: HTTP ${res.status} (record ${id} left behind)${bodyExcerpt(text)}`)
  } catch (e) { failures.push(`crud.delete: ${e.message}`) }
}

/**
 * @param {object} crud       the manifest's smoke.crud block
 * @param {object} deps       { http(method, path, body, {auth}) → {res:{ok,status}, json}, getTeamId() → Promise<string|undefined>, log(msg), rand? }
 * @returns {Promise<string[]>} failure messages (empty = pass)
 */
export async function runCrud(crud, { http, getTeamId, log = () => {}, rand = Math.random().toString(36).slice(2, 8) }) {
  const failures = []
  const vars = { rand }
  if (JSON.stringify(crud).includes('{teamId}')) {
    vars.teamId = await getTeamId()
    if (!vars.teamId) return ['crud: path uses {teamId} but the session has no active team']
  }
  const ctx = { http, fill: v => fillPlaceholders(v, vars), failures, log }

  const c = crud.create
  const { res: cr, json: cj, text: ct } = await http(c.method || 'POST', ctx.fill(c.path), ctx.fill(c.body ?? {}))
  if (!cr.ok) return [`crud.create: HTTP ${cr.status}${bodyExcerpt(ct)}`]
  const id = crud.idFrom ? dotGet(cj, crud.idFrom) : (cj?.id ?? cj?.data?.id)
  vars.id = id
  log(`✓ crud.create ok${id != null ? ` (id=${id})` : ''}`)
  if (id == null) return ['crud.create: response has no id']

  await runChecks(crud, ctx)
  if (crud.delete) await runDelete(crud.delete, id, ctx)
  return failures
}
