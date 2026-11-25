// "First-run" red checks (#3470). Workflows load their helpers from the default-branch checkout, so a
// PR that ADDS a helper (or an export) fails the check that imports it until the PR reaches main.
// That failure says nothing about the PR; this module recognises exactly that error shape, and only it.
//
// Pure — the workflow gathers annotations and file sources, this decides.

const ID = '[A-Za-z_$][\\w$]*'

export function parseFirstRunError(message) {
  const text = String(message || '')
  let m = text.match(/Cannot find module '([^']+)'/)
  if (m && /ERR_MODULE_NOT_FOUND/.test(text)) return { kind: 'module', path: m[1] }
  m = text.match(new RegExp(`TypeError: (${ID}) is not a function`))
  if (m) return { kind: 'export', name: m[1] }
  m = text.match(new RegExp(`does not provide an export named '(${ID})'`))
  if (m) return { kind: 'export', name: m[1] }
  return null
}

const exportsName = (src, name) => {
  if (typeof src !== 'string') return false
  const esc = name.replace(/\$/g, '\\$')
  if (new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|let|var|class)\\s+${esc}(?![\\w$])`).test(src)) return true
  for (const list of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of list[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/)
      if ((bits[1] || bits[0]).trim() === name) return true
    }
  }
  return false
}

// messages: failure-level annotation texts of ONE red check.
// files: [{ path, head, main }] — files differing between main (what the check loaded) and the PR head.
export function classifyFirstRun({ messages = [], files = [] } = {}) {
  if (!messages.length) return { firstRun: false, reason: 'no failure message' }
  for (const msg of messages) {
    const err = parseFirstRunError(msg)
    if (!err) return { firstRun: false, reason: 'unrecognised failure' }
    const explained = err.kind === 'module'
      ? files.some(f => f.head != null && f.main == null && err.path.endsWith('/' + f.path))
      : files.some(f => exportsName(f.head, err.name) && !exportsName(f.main, err.name))
    if (!explained) return { firstRun: false, reason: 'code already on main' }
  }
  return { firstRun: true, reason: 'fails only because the PR adds the code it loads' }
}

// The red check-runs (matched by id — names repeat across workflows) that are first-run failures for this PR (#3470). I/O wrapper around
// parseFirstRunError/classifyFirstRun; the workflow passes its octokit so no logic sits inline.
async function readSource({ github, owner, repo }, path, ref) {
  try {
    const d = (await github.rest.repos.getContent({ owner, repo, path, ref })).data
    return Buffer.from(d.content || '', 'base64').toString('utf8')
  } catch (e) { if (e.status === 404) return null; throw e }
}

// JS files the PR touches, with their content on the PR head and on the default branch.
async function changedJsFiles(c, pr, defaultBranch) {
  const { github, owner, repo } = c
  const cmp = (await github.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${defaultBranch}...${pr.head.sha}` })).data
  const files = []
  for (const f of (cmp.files || []).filter(f => /\.(mjs|js|cjs)$/.test(f.filename))) {
    files.push({ path: f.filename, head: f.status === 'removed' ? null : await readSource(c, f.filename, pr.head.sha), main: await readSource(c, f.filename, defaultBranch) })
  }
  return files
}

async function failureMessages({ github, owner, repo }, run) {
  const anns = await github.paginate(github.rest.checks.listAnnotations, { owner, repo, check_run_id: run.id, per_page: 50 })
  return anns.filter(a => a.annotation_level === 'failure').map(a => a.message || '')
}

export async function firstRunNames({ github, core, owner, repo, pr, redRuns, defaultBranch }) {
  const c = { github, owner, repo }
  const found = []
  let files = null
  for (const run of redRuns) {
    try {
      const messages = await failureMessages(c, run)
      if (!messages.length || !messages.every(m => parseFirstRunError(m))) continue
      files ??= await changedJsFiles(c, pr, defaultBranch)
      if (classifyFirstRun({ messages, files }).firstRun) found.push(run)
    } catch (e) { core.warning(`first-run classify ${run.name}: ${e.message}`) }
  }
  return found
}

// One PR note per head commit when a merge went ahead over first-run checks (#3470).
export async function noteFirstRunIgnored({ github, core, owner, repo, pull_number, sha, names }) {
  const list = names.join(', '), mark = `<!-- first-run-ignored:${sha} -->`
  core.info(`#${pull_number} first-run check ${list} ignored after owner ok`)
  const prior = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: pull_number, per_page: 100 })
  if (prior.some(c => (c.body || '').includes(mark))) return
  await github.rest.issues.createComment({ owner, repo, issue_number: pull_number,
    body: `<!-- pipeline-note -->\n${mark}\nℹ️ Merged over first-run check(s) ${list} — they fail only because this PR adds the code they load.` })
}

// Red verdict for a PR (#3470): a red check counts unless it is a first-run failure. Matched by check-run
// id, never by name — names repeat across workflows, so a real failure in a same-named run still blocks.
export const redAfterFirstRun = ({ statusRed = false, redRuns = [], firstRunRuns = [] }) =>
  statusRed || redRuns.some(r => !firstRunRuns.some(f => f.id === r.id))

// isRed() resolves { statusRed, redRuns }; returns { red, firstRun: [names] } for the merge decision.
export async function firstRunSplit({ isRed, pull_number, ...ctx }) {
  const { statusRed, redRuns } = await isRed()
  const firstRunRuns = redRuns.length ? await firstRunNames({ ...ctx, redRuns }) : []
  return { red: redAfterFirstRun({ statusRed, redRuns, firstRunRuns }), firstRun: firstRunRuns.map(r => r.name),
    noteIgnored: names => noteFirstRunIgnored({ ...ctx, pull_number, sha: ctx.pr.head.sha, names }) }
}
