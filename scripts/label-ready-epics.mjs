#!/usr/bin/env node
/**
 * Stamp open epics with their "finished but still open" state — the single source
 * of truth both digests (epic-digest, housekeeping) read. Deterministic, no LLM.
 *
 *   GITHUB_TOKEN=... node scripts/label-ready-epics.mjs            # dry-run (default)
 *   GITHUB_TOKEN=... APPLY=true node scripts/label-ready-epics.mjs # actually mutate labels
 *
 * For every `is:issue is:open label:epic`:
 *   - all sub-issues closed (total > 0) AND a `postmortem:done` marker exists on a
 *     comment  → `status:ready-to-close`
 *   - all sub-issues closed (total > 0) AND no postmortem marker
 *                                            → `status:needs-postmortem`
 *   - otherwise (open children, or no children)
 *                                            → neither (remove both if present)
 * An epic carries AT MOST ONE of the two labels at any time.
 *
 * This is the ONLY piece of the #763 system that MUTATES GitHub — the digests stay
 * report-only. It's split into its own script + workflow by blast radius, exactly like
 * housekeeping's prune-merged-branches.mjs. Default is dry-run; the workflow sets APPLY.
 *
 * Env:
 *   GITHUB_TOKEN   (required) repo-scoped token; the Action passes the built-in one
 *   DIGEST_REPO    default "FriendlyInternet/nuxt-crouton"
 *   APPLY          "true" to write labels; anything else = dry-run (list only)
 */

const REPO = process.env.DIGEST_REPO || 'FriendlyInternet/nuxt-crouton'
const [OWNER, NAME] = REPO.split('/')
const APPLY = process.env.APPLY === 'true' || process.argv.includes('--apply')
const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('label-ready-epics.mjs: GITHUB_TOKEN is required')
  process.exit(1)
}

const READY = 'status:ready-to-close'
const NEEDS = 'status:needs-postmortem'
const MANAGED = [READY, NEEDS]
const MARKER = 'postmortem:done'

async function gh(path, init) {
  const res = await fetch('https://api.github.com' + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'label-ready-epics',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {})
    }
  })
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}
const search = async (q) =>
  (await gh(`/search/issues?per_page=100&q=${encodeURIComponent(q)}`)).items || []
const labelNames = (it) => (it.labels || []).map((l) => (typeof l === 'string' ? l : l.name))

async function subIssues(number) {
  try {
    return await gh(`/repos/${OWNER}/${NAME}/issues/${number}/sub_issues?per_page=100`)
  } catch {
    return []
  }
}

// Has any comment on the epic carried the postmortem marker? (HTML-comment marker the
// postmortem skill leads with — invisible when rendered, present in the raw body.)
async function hasPostmortem(number) {
  try {
    const comments = await gh(`/repos/${OWNER}/${NAME}/issues/${number}/comments?per_page=100`)
    return (comments || []).some((c) => (c.body || '').includes(MARKER))
  } catch {
    return false
  }
}

// Decide the target label for an epic from its children + postmortem state.
// null ⇒ epic doesn't qualify (carry neither managed label).
async function targetLabel(epic) {
  const kids = await subIssues(epic.number)
  const allClosed = kids.length > 0 && kids.every((k) => k.state === 'closed')
  if (!allClosed) return null
  return (await hasPostmortem(epic.number)) ? READY : NEEDS
}

async function setLabels(number, current, target) {
  // Desired managed set = {target} (or {} when target is null). Diff against current.
  const has = new Set(current.filter((n) => MANAGED.includes(n)))
  const want = new Set(target ? [target] : [])
  const toAdd = [...want].filter((n) => !has.has(n))
  const toRemove = [...has].filter((n) => !want.has(n))
  if (!toAdd.length && !toRemove.length) return { changed: false }
  if (APPLY) {
    for (const name of toRemove) {
      await gh(`/repos/${OWNER}/${NAME}/issues/${number}/labels/${encodeURIComponent(name)}`, {
        method: 'DELETE'
      })
    }
    if (toAdd.length) {
      await gh(`/repos/${OWNER}/${NAME}/issues/${number}/labels`, {
        method: 'POST',
        body: JSON.stringify({ labels: toAdd })
      })
    }
  }
  return { changed: true, toAdd, toRemove }
}

const epics = await search(`repo:${REPO} is:issue is:open label:epic`)
let changes = 0
const log = []
for (const e of epics) {
  const target = await targetLabel(e)
  const current = labelNames(e)
  const { changed, toAdd, toRemove } = await setLabels(e.number, current, target)
  if (changed) {
    changes++
    const bits = [
      ...(toAdd || []).map((n) => `+${n}`),
      ...(toRemove || []).map((n) => `-${n}`)
    ].join(' ')
    log.push(`  #${e.number} ${bits}  — ${e.title}`)
  }
}

const mode = APPLY ? 'APPLIED' : 'DRY-RUN (set APPLY=true to write)'
console.log(`label-ready-epics: ${mode} · ${epics.length} open epics · ${changes} change(s)`)
if (log.length) console.log(log.join('\n'))
else console.log('  nothing to change — every open epic already carries the right label')
