/**
 * Which deploy runs, which apps and which check run the "Preview screenshot" capture uses (#4535).
 *
 * The rule: for one commit, the final "Preview screenshot" result is the same whichever deploy
 * (Deploy Apps / Deploy POCs) finishes last, and a check this workflow starts always ends.
 * How: a capture that finds any deploy for the commit still running waits (leaves the check open);
 * every deploy completion (any conclusion) starts a capture, so the last capture sees every deploy
 * finished, reads the same records whatever the order, and decides.
 *
 * CLI (used by .github/workflows/preview-screenshot.yml):
 *   node scripts/lib/screenshot-targets.mjs runs <runs.json>                 -> run_ids= pending= failed= wait=
 *   node scripts/lib/screenshot-targets.mjs select <records-dir> --out <f>   -> count= apps= missing=
 *       (env PR_BODY, CHANGED_FILES, FAILED)
 *   node scripts/lib/screenshot-targets.mjs check <checkruns.json>           -> id=
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CHECK_NAME = 'Preview screenshot'

/**
 * Newest pull_request run per deploy workflow → which runs to read, which are still running,
 * which finished without success.
 * @param {{workflow:string,id:number,status:string,conclusion:string|null,event:string}[]} runs
 */
export function deployRunState(runs) {
  const newest = new Map()
  for (const r of Array.isArray(runs) ? runs : []) {
    if (r?.event !== 'pull_request') continue
    const cur = newest.get(r.workflow)
    if (!cur || Number(r.id) > Number(cur.id)) newest.set(r.workflow, r)
  }
  const runIds = []
  const pending = []
  const failed = []
  for (const [wf, r] of [...newest.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (r.status !== 'completed') pending.push(wf)
    else if (r.conclusion === 'success') runIds.push(String(r.id))
    else failed.push(wf)
  }
  return { runIds, pending, failed, wait: pending.length > 0 }
}

/** Unique app names the PR body declares with `<!-- review-surface: <app> <path> … -->`. */
export function declaredApps(prBody) {
  const out = []
  // Same pattern as parsePrSurfaces in scripts/capture-review-surfaces.mjs.
  for (const m of String(prBody || '').matchAll(/<!--\s*review-surface:\s*(.+?)\s*-->/g)) {
    const [app, path] = m[1].split(/\s+/)
    if (app && path && !out.includes(app)) out.push(app)
  }
  return out
}

/** Apps whose own folder (`apps/<x>/…`, `pocs/<x>/…`) the PR changes. */
function changedApps(changedFiles) {
  const out = new Set()
  for (const f of changedFiles || []) {
    const m = /^(?:apps|pocs)\/([^/]+)\//.exec(String(f).trim())
    if (m) out.add(m[1])
  }
  return out
}

/**
 * Which record apps to shoot.
 * With a marker: only the declared apps; a declared app with no record is `missing` (red).
 * Without one: the record apps whose own folder changed, else every record app (as before);
 * `missing` is always '' — narrowing never invents a red.
 */
export function selectApps({ recordApps = [], prBody = '', changedFiles = [], failed = [] }) {
  const declared = declaredApps(prBody)
  if (declared.length) {
    const apps = recordApps.filter(a => declared.includes(a))
    const lost = declared.filter(a => !recordApps.includes(a))
    let missing = ''
    if (lost.length) {
      missing = `review-surface declared for ${lost.join(', ')}, but this commit's deploys left no preview for it`
      if (failed.length) missing += ` — ${failed.join(', ')} did not succeed`
    }
    return { apps, missing }
  }
  const changed = changedApps(changedFiles)
  const narrowed = recordApps.filter(a => changed.has(a))
  return { apps: narrowed.length ? narrowed : [...recordApps], missing: '' }
}

/** Id of the newest check run named exactly "Preview screenshot", or ''. */
export function pickCheckRun(checkRuns) {
  const list = Array.isArray(checkRuns) ? checkRuns : (checkRuns?.check_runs || [])
  let best = null
  for (const c of list) {
    if (c?.name !== CHECK_NAME) continue
    if (!best || Number(c.id) > Number(best.id)) best = c
  }
  return best ? String(best.id) : ''
}

/** The whole decision for one capture: wait, or which runs and apps (and what is missing). */
export function decide({ runs, recordApps = [], prBody = '', changedFiles = [] }) {
  const state = deployRunState(runs)
  if (state.wait) return { wait: true, runIds: state.runIds, apps: [], missing: '', pending: state.pending }
  const { apps, missing } = selectApps({ recordApps, prBody, changedFiles, failed: state.failed })
  return { wait: false, runIds: state.runIds, apps, missing, pending: [] }
}

function findMetas(dir) {
  const out = []
  let entries = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries.sort()) {
    const p = join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) out.push(...findMetas(p))
    else if (e === 'meta.json') out.push(p)
  }
  return out
}

const oneLine = s => String(s).replace(/\s+/g, ' ').trim()

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, arg, ...rest] = process.argv.slice(2)
  if (cmd === 'runs') {
    const s = deployRunState(JSON.parse(readFileSync(arg, 'utf8')))
    console.log(`run_ids=${s.runIds.join(' ')}`)
    console.log(`pending=${s.pending.join(', ')}`)
    console.log(`failed=${s.failed.join(', ')}`)
    console.log(`wait=${s.wait}`)
  } else if (cmd === 'select') {
    const outAt = rest.indexOf('--out')
    const outFile = outAt >= 0 ? rest[outAt + 1] : ''
    const metas = findMetas(arg).map(p => {
      let app = ''
      try { app = JSON.parse(readFileSync(p, 'utf8')).app || '' } catch {}
      return { p, app }
    }).filter(m => m.app)
    const recordApps = [...new Set(metas.map(m => m.app))]
    const { apps, missing } = selectApps({
      recordApps,
      prBody: process.env.PR_BODY || '',
      changedFiles: String(process.env.CHANGED_FILES || '').split('\n').filter(Boolean),
      failed: String(process.env.FAILED || '').split(',').map(s => s.trim()).filter(Boolean),
    })
    const chosen = metas.filter(m => apps.includes(m.app)).map(m => m.p)
    if (outFile) writeFileSync(outFile, chosen.map(p => `${p}\n`).join(''))
    console.log(`count=${chosen.length}`)
    console.log(`apps=${apps.join(' ')}`)
    console.log(`missing=${oneLine(missing)}`)
  } else if (cmd === 'check') {
    console.log(`id=${pickCheckRun(JSON.parse(readFileSync(arg, 'utf8')))}`)
  } else {
    console.error('usage: screenshot-targets.mjs runs <runs.json> | select <records-dir> --out <file> | check <checkruns.json>')
    process.exit(2)
  }
}
