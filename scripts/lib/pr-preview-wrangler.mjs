/**
 * Rewrite a built wrangler config into a PER-PR PREVIEW environment (#2020).
 *
 * THE BUG THIS FIXES. A PR deploy ran the app's own `cf:staging`, which targets the app's
 * single staging Worker and its configured `stagingUrl`. So every PR — and every merge to
 * `main` — published to the SAME place. Two PRs open on one app clobbered each other, a
 * merge overwrote whatever preview was there, and the PR comment cheerfully described the
 * result as "isolated, auto-provisioned … its own D1 + KV". A reviewer tapping that link
 * had no way to know whose code they were looking at.
 *
 * WHAT ISOLATION ACTUALLY REQUIRES. Renaming the Worker is not enough: the bindings in the
 * built config still carry the staging `database_id` / KV `id`, so a renamed Worker would
 * quietly share staging's DATA. Three things have to change together:
 *
 *   1. `name`         → `<app>-pr<n>`, so it is a different Worker.
 *   2. binding IDs    → dropped, so wrangler AUTO-PROVISIONS fresh D1/KV for this preview.
 *                       This is the same id-less first-deploy path the app itself uses.
 *   3. `routes`       → dropped, so it publishes to `*.workers.dev` instead of trying to
 *                       bind the app's custom domain — which staging already owns, and
 *                       which would either fail or steal the real hostname.
 *
 * Miss (2) and the preview writes to staging's database. Miss (3) and it fights staging for
 * the domain. Renaming alone would look right and be worse than doing nothing, because the
 * comment would finally be telling the truth about a Worker that still wasn't isolated.
 */

/** D1/KV/R2 id fields wrangler treats as "already provisioned — reuse this". */
const ID_FIELDS = ['database_id', 'id', 'bucket_name', 'preview_database_id', 'preview_id']

/**
 * @param {object} config  Parsed wrangler config (the BUILT one, e.g. .output/server/wrangler.json).
 * @param {string} app     App name, e.g. "kassa".
 * @param {number|string} pr  PR number.
 * @returns {{ config: object, name: string, changed: string[] }}
 */
/** Binding sections, and which field (if any) carries the resource's human name. */
const BINDING_SECTIONS = [
  ['d1_databases', 'database_name'],
  ['kv_namespaces', null],
  ['r2_buckets', 'bucket_name'],
]

/**
 * Strip everything that ties the config to a REAL environment: the custom-domain route it
 * would otherwise fight staging for, and any nested `env` block that would smuggle staging's
 * bindings straight back in.
 */
function detachFromRealEnvs(out, changed) {
  for (const key of ['routes', 'route', 'env']) {
    if (out[key]) { delete out[key]; changed.push(`dropped ${key}`) }
  }
  // The workers.dev hostname IS the deliverable — without it there is no link to post.
  if (out.workers_dev !== true) { out.workers_dev = true; changed.push('workers_dev=true') }
}

/**
 * Make every binding provision fresh. The BINDING name is preserved (the app's code refers
 * to it); only the provisioned id goes, plus a per-PR resource name so two previews cannot
 * land on the same database.
 */
function scrubBindings(out, name, changed) {
  for (const [section, nameField] of BINDING_SECTIONS) {
    for (const b of out[section] || []) {
      for (const f of ID_FIELDS) {
        if (f in b) { delete b[f]; changed.push(`${section}.${b.binding}: dropped ${f}`) }
      }
      if (!nameField) continue
      b[nameField] = `${name}-${b.binding}`.toLowerCase()
      changed.push(`${section}.${b.binding}: ${nameField}=${b[nameField]}`)
    }
  }
}

export function toPrPreview(config, app, pr) {
  if (!config || typeof config !== 'object') throw new TypeError('config must be an object')
  if (!app) throw new TypeError('app is required')
  if (!/^\d+$/.test(String(pr))) throw new TypeError(`pr must be a number, got ${JSON.stringify(pr)}`)

  const out = structuredClone(config)
  const name = `${app}-pr${pr}`
  const changed = [`name=${name}`]
  out.name = name

  detachFromRealEnvs(out, changed)
  scrubBindings(out, name, changed)

  return { config: out, name, changed }
}

/**
 * The D1 database name this preview will provision for a given binding — the migrate step
 * needs it, and deriving it in two places is how they drift.
 */
export function previewDbName(app, pr, binding = 'DB') {
  return `${app}-pr${pr}-${binding}`.toLowerCase()
}
