/**
 * Make a PR preview's deploy repeatable (#2608).
 *
 * Per-PR previews strip their storage ids so `wrangler deploy` creates fresh D1/KV, named
 * after the preview (#2020). Normally a redeploy is fine: wrangler reuses what the existing
 * Worker is bound to. But if a deploy dies AFTER creating the storage and BEFORE the Worker
 * exists (two deploys racing, a timeout, a cancelled run), nothing is bound to it — and every
 * later deploy tries to create it again and fails:
 *
 *     a namespace with this account ID and title already exists [code: 10014]
 *
 * so the preview stays broken for good (#2571). The fix is to look first: storage that
 * already exists under the preview's names is pinned by id and reused; only what's missing
 * is left for wrangler to create.
 *
 * Pure — the CLI (`scripts/pr-preview-reuse.mjs`) fetches the lists from wrangler.
 */

/**
 * The title wrangler gives a KV namespace it creates for a binding: `<worker>-<binding>`,
 * lowercased. Observed in the #2571 deploy log: Worker `booking-demo-pr2571`, binding `KV`
 * → "booking-demo-pr2571-kv". The teardown deletes by this title too, so derive it once.
 */
export function previewKvTitle(worker, binding) {
  return `${worker}-${binding}`.toLowerCase()
}

/**
 * @param {object} config  parsed BUILT preview config (mutated in place)
 * @param {{ d1List?: Array<{name?:string, uuid?:string, id?:string}>, kvList?: Array<{title?:string, id?:string}> }} lists
 *   `wrangler d1 list --json` and `wrangler kv namespace list`
 * @returns {{ reused: string[], fresh: string[] }}
 */
export function reuseExisting(config, { d1List = [], kvList = [] } = {}) {
  const reused = []
  const fresh = []

  for (const b of config?.d1_databases || []) {
    if (b.database_id) continue
    const hit = (d1List || []).find(d => d.name === b.database_name)
    // wrangler has used both keys across versions (same as pr-preview-db-id).
    const id = hit && (hit.uuid || hit.id)
    if (id) { b.database_id = id; reused.push(`${b.binding} → ${id}`) }
    else fresh.push(b.binding)
  }

  for (const b of config?.kv_namespaces || []) {
    if (b.id) continue
    const id = findKvId(kvList, previewKvTitle(config.name, b.binding))
    if (id) { b.id = id; reused.push(`${b.binding} → ${id}`) }
    else fresh.push(b.binding)
  }

  return { reused, fresh }
}

/** A KV namespace's id by its title, or null. Teardown deletes by id, never by title. */
export function findKvId(kvList, title) {
  return (kvList || []).find(n => n.title === title)?.id ?? null
}
