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

/**
 * @param {object} crud       the manifest's smoke.crud block
 * @param {object} deps       { http(method, path, body, {auth}) → {res:{ok,status}, json}, getTeamId() → Promise<string|undefined>, log(msg), rand? }
 * @returns {Promise<string[]>} failure messages (empty = pass)
 */
export async function runCrud(crud, { http, getTeamId, log = () => {}, rand = Math.random().toString(36).slice(2, 8) }) {
  const failures = []
  const vars = { rand }
  const needsTeam = JSON.stringify(crud).includes('{teamId}')
  if (needsTeam) {
    vars.teamId = await getTeamId()
    if (!vars.teamId) return ['crud: path uses {teamId} but the session has no active team']
  }
  const fill = v => fillPlaceholders(v, vars)

  const c = crud.create
  const { res: cr, json: cj } = await http(c.method || 'POST', fill(c.path), fill(c.body ?? {}))
  if (!cr.ok) return [`crud.create: HTTP ${cr.status}`]
  const id = crud.idFrom ? dotGet(cj, crud.idFrom) : (cj?.id ?? cj?.data?.id)
  vars.id = id
  log(`✓ crud.create ok${id != null ? ` (id=${id})` : ''}`)
  if (id == null) failures.push('crud.create: response has no id')

  const check = async (name, step, { auth, method = 'GET', body }) => {
    const { res, json } = await http(method, fill(step.path), body, { auth })
    const text = JSON.stringify(json ?? '')
    const expect = step.expectIncludes == null ? null : fill(step.expectIncludes)
    if (!res.ok || (expect && !text.includes(expect))) {
      failures.push(`crud.${name}: HTTP ${res.status}${expect ? ` / missing "${expect}"` : ''}`)
      return false
    }
    return true
  }

  if (id != null) {
    if (crud.update) {
      const u = crud.update
      if (await check('update', u, { auth: true, method: u.method || 'PATCH', body: fill(u.body ?? {}) })) log('✓ crud.update ok')
    }
    if (crud.read && await check('read', crud.read, { auth: true })) log('✓ crud.read ok — saved record reads back')
    if (crud.readPublic && await check('readPublic', crud.readPublic, { auth: false })) log('✓ crud.readPublic ok — created record is publicly readable')

    if (crud.delete) {
      const d = crud.delete
      try {
        const { res } = await http(d.method || 'DELETE', fill(d.path), undefined, { auth: true })
        if (res.ok) log('✓ crud.delete ok')
        else failures.push(`crud.delete: HTTP ${res.status} (record ${id} left behind)`)
      } catch (e) { failures.push(`crud.delete: ${e.message}`) }
    }
  }
  return failures
}
