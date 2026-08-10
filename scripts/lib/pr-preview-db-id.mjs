/**
 * Resolve the PR-preview's provisioned D1 ids into its BUILT wrangler config (#2085).
 *
 * WHY THIS EXISTS. Per-PR previews deliberately strip `database_id` from the built config
 * so `wrangler deploy` AUTO-PROVISIONS a fresh database per PR (#2020) — keeping the
 * preview off staging's data. #2079 then pointed `d1 migrations apply` at that same built
 * config, because it is the only place the PR-scoped `database_name` exists. Both moves are
 * right, and together they leave a gap: remote D1 operations need the **id**, and the id
 * does not exist until the deploy that creates it has run.
 *
 *     ✘ Found a database with name or binding velo-pr2080-db but it is missing a
 *       database_id, which is needed for operations on remote resources.
 *
 * So this runs BETWEEN deploy and migrate: ask wrangler which databases exist, match by the
 * name already in the config, and write the id in.
 *
 * IT FAILS LOUDLY ON A MISS. A preview that quietly skips its migrations is exactly the
 * #2078 failure — an empty database behind a link that looks like a working preview — and
 * that one went unnoticed for weeks precisely because nothing complained.
 */

/**
 * @param {object}   config      parsed built wrangler config (mutated in place)
 * @param {Array<{name?:string, uuid?:string, id?:string}>} d1List  `wrangler d1 list --json`
 * @returns {{ resolved: string[], missing: string[], alreadySet: string[] }}
 */
export function applyD1Ids(config, d1List) {
  const resolved = []
  const missing = []
  const alreadySet = []

  for (const b of config?.d1_databases || []) {
    if (b.database_id) { alreadySet.push(b.database_name || b.binding); continue }
    const name = b.database_name
    if (!name) { missing.push(`<binding ${b.binding} has no database_name>`); continue }
    const hit = (d1List || []).find((d) => d.name === name)
    // wrangler has used both keys across versions; take whichever is present rather than
    // betting on one and silently resolving to `undefined`.
    const id = hit && (hit.uuid || hit.id)
    if (!id) { missing.push(name); continue }
    b.database_id = id
    resolved.push(`${name} → ${id}`)
  }
  return { resolved, missing, alreadySet }
}
