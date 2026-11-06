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

// Names of the red check-runs that are first-run failures for this PR (#3470). I/O wrapper around
// parseFirstRunError/classifyFirstRun; the workflow passes its octokit so no logic sits inline.
export async function firstRunNames({ github, core, owner, repo, pr, redRuns, defaultBranch }) {
  const names = []
  let files = null
  const src = async (path, ref) => {
    try {
      const d = (await github.rest.repos.getContent({ owner, repo, path, ref })).data
      return Buffer.from(d.content || '', 'base64').toString('utf8')
    } catch (e) { if (e.status === 404) return null; throw e }
  }
  for (const run of redRuns) {
    try {
      const anns = await github.paginate(github.rest.checks.listAnnotations, { owner, repo, check_run_id: run.id, per_page: 50 })
      const messages = anns.filter(a => a.annotation_level === 'failure').map(a => a.message || '')
      if (!messages.length || !messages.every(m => parseFirstRunError(m))) continue
      if (!files) {
        const cmp = (await github.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${defaultBranch}...${pr.head.sha}` })).data
        files = []
        for (const f of (cmp.files || []).filter(f => /\.(mjs|js|cjs)$/.test(f.filename))) {
          files.push({ path: f.filename, head: f.status === 'removed' ? null : await src(f.filename, pr.head.sha), main: await src(f.filename, defaultBranch) })
        }
      }
      if (classifyFirstRun({ messages, files }).firstRun) names.push(run.name)
    } catch (e) { core.warning(`first-run classify ${run.name}: ${e.message}`) }
  }
  return names
}
