// fresh-epic-branch.mjs — the owner's `/fresh-branch` command on an epic (#3881).
//
// WHY. An epic branch that has drifted too far from main was fixed by hand: a session edited
// `epic_branch=` in every child to a new name (#3194). The old branch kept being picked up by the
// `epic/<n>-` prefix lookups. Now the owner comments `/fresh-branch` on the epic and this script
// RENAMES the old branch to `archive/<old name>` — nothing is deleted, every ticket keeps the same
// branch name, and the next worker run finds the name missing and cuts it fresh from main
// (scripts/sync-epic-branch.sh, the #2788 missing-branch path). Undo = rename it back.
//
// It creates no branch and edits no ticket body (only an existing `## Decisions` log gets a line).
// Decisions are pure (decideFreshBranch, collectBranches, summarizeAhead, renderReport);
// runFreshBranch does the I/O with the github-script context (on-comment.yml `fresh-branch`,
// Harness App token — a branch rename needs contents write).
import { parsePipelineBlock } from './pipeline-context.mjs'

export const ARCHIVE_PREFIX = 'archive/'
export const MAX_DEPTH = 5
export const MAX_SUBJECTS = 20
export const POLL_MS = 5000
export const POLL_LIMIT_MS = 60000

const PUSH = ['admin', 'write']

/**
 * @param {{ state?: string, perm?: string, branches?: string[], openPrs?: {number:number,title?:string,url?:string}[], archiveExists?: boolean }} input
 * @returns {{ action: 'ignore', reason: string }
 *   | { action: 'refuse', reason: string, prs: object[] }
 *   | { action: 'rename', branch: string, archive: string }}
 */
export function decideFreshBranch({ state = 'open', perm = 'none', branches = [], openPrs = [], archiveExists = false } = {}) {
  const no = ignoreReason({ state, perm })
  if (no) return { action: 'ignore', reason: no }
  if (!branches.length) return { action: 'refuse', reason: 'no ticket in this epic names an `epic_branch=` in its pipeline line, so there is no branch to set aside', prs: [] }
  if (branches.length > 1) return { action: 'refuse', reason: `the tickets name more than one branch: ${branches.map(b => `\`${b}\``).join(', ')} — make them agree first`, prs: [] }
  const branch = branches[0]
  const archive = ARCHIVE_PREFIX + branch
  if (openPrs.length) return { action: 'refuse', reason: `open pull requests still use \`${branch}\` — merge or close them first`, prs: openPrs }
  if (archiveExists) return { action: 'refuse', reason: `\`${archive}\` already exists — rename or delete it first`, prs: [] }
  return { action: 'rename', branch, archive }
}

/** Why the command is ignored outright (closed epic, no push access), or null. */
export function ignoreReason({ state = 'open', perm = 'none' } = {}) {
  if (state === 'closed') return 'epic is closed'
  if (!PUSH.includes(perm)) return `no push access (perm=${perm})`
  return null
}

/**
 * The distinct `epic_branch` values on the epic and its OPEN sub-issues, up to MAX_DEPTH levels down.
 * @param {{ body?: string, children?: object[] }} tree  each child: `{ body, state, children }`
 * @returns {string[]} sorted, unique
 */
export function collectBranches(tree = {}) {
  const found = new Set()
  const walk = (node, depth) => {
    const b = parsePipelineBlock(node.body || '').epic_branch
    if (b) found.add(b)
    if (depth >= MAX_DEPTH) return
    for (const child of node.children || []) {
      if (child.state && child.state !== 'open') continue
      walk(child, depth + 1)
    }
  }
  walk(tree, 0)
  return [...found].sort()
}

/**
 * What would be left behind: the compare main...<branch> result, merge commits dropped.
 * @param {{ ahead_by?: number, html_url?: string, commits?: {sha:string, parents?:object[], commit?:{message?:string}}[] }} compare
 */
export function summarizeAhead(compare = {}) {
  const own = (compare.commits || []).filter(c => (c.parents || []).length < 2)
  const subjects = own.slice(0, MAX_SUBJECTS).map(c => ({
    sha: String(c.sha || '').slice(0, 7),
    subject: String(c.commit?.message || '').split('\n')[0],
  }))
  return { aheadBy: compare.ahead_by ?? own.length, nonMerge: own.length, subjects, more: Math.max(0, own.length - MAX_SUBJECTS), url: compare.html_url || '' }
}

const HEADER = '<!-- pipeline-note -->\n> 🤖 **agent pipeline (CI)** · _/fresh-branch on an epic (#3881)_\n\n'

function aheadBlock(ahead) {
  if (!ahead) return ''
  if (!ahead.nonMerge) return `Nothing on the old branch is missing from main${ahead.url ? ` ([compare](${ahead.url}))` : ''}.\n`
  const lines = ahead.subjects.map(s => `- \`${s.sha}\` ${s.subject}`)
  if (ahead.more) lines.push(`- …and ${ahead.more} more`)
  return `${ahead.nonMerge} commit(s) on the old branch are not on main (merge commits left out)${ahead.url ? ` — [compare](${ahead.url})` : ''}:\n\n${lines.join('\n')}\n`
}

/**
 * The reply on the epic.
 * @param {{ outcome: 'renamed'|'failed'|'refused', branch?: string, archive?: string, ahead?: object, reason?: string, prs?: object[], actor?: string, runUrl?: string }} r
 */
export function renderReport({ outcome, branch, archive, ahead, reason = '', prs = [], actor = '', runUrl = '' } = {}) {
  const by = actor ? ` · asked by \`${actor}\`` : ''
  const depth = runUrl ? `\n**Run:** ${runUrl}\n` : ''
  if (outcome === 'refused') {
    const list = prs.length ? '\n' + prs.map(p => `- #${p.number}${p.title ? ` ${p.title}` : ''}`).join('\n') + '\n' : ''
    return HEADER + `🔴 **Branch not set aside** — ${reason}.${by}\n${list}\n**You:** fix that, then comment \`/fresh-branch\` again.\n${depth}`
  }
  if (outcome === 'failed') {
    return HEADER + `🔴 **The branch move did not finish** — \`${branch}\` still exists and \`${archive}\` was not confirmed. ${reason}${by}\n\n`
      + `**You:** check the branches on GitHub, then comment \`/fresh-branch\` again.\n`
      + `<details><summary>What is on the old branch</summary>\n\n${aheadBlock(ahead)}\n</details>\n${depth}`
  }
  return HEADER + `🔀 **Fresh branch** — the old \`${branch}\` is now \`${archive}\`; the next worker run cuts \`${branch}\` fresh from main.${by}\n\n`
    + `**You:** nothing, unless the list below holds work you still want. Undo = rename \`${archive}\` back to \`${branch}\`.\n\n`
    + `<details><summary>What stays on the old branch</summary>\n\n${aheadBlock(ahead)}\n</details>\n${depth}`
}

/** One dated line for the epic's `## Decisions` log, or null when the body has no such heading. */
export function decisionsBody(body, { branch, archive, date }) {
  if (!/^##\s+Decisions\b/m.test(body || '')) return null
  const line = `- ${date} — \`/fresh-branch\`: \`${branch}\` set aside as \`${archive}\` → the next run cuts it fresh from main (#3881)`
  return String(body).replace(/\s*$/, '') + '\n' + line + '\n'
}

const is404 = e => e && (e.status === 404 || e.status === '404')

async function refExists(github, repo, ref) {
  try {
    await github.rest.git.getRef({ ...repo, ref })
    return true
  } catch (e) {
    if (is404(e)) return false
    throw e
  }
}

/** The epic plus its open sub-issues as a tree, MAX_DEPTH levels down. */
async function loadTree(github, repo, issue, depth = 0) {
  const node = { number: issue.number, body: issue.body || '', state: issue.state, children: [] }
  if (depth >= MAX_DEPTH) return node
  const subs = await github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', { ...repo, issue_number: issue.number, per_page: 100 })
  for (const s of subs) {
    if (s.state !== 'open') continue
    node.children.push(await loadTree(github, repo, s, depth + 1))
  }
  return node
}

async function openPrsFor(github, repo, branch) {
  const asBase = await github.paginate(github.rest.pulls.list, { ...repo, state: 'open', base: branch, per_page: 100 })
  const asHead = await github.paginate(github.rest.pulls.list, { ...repo, state: 'open', head: `${repo.owner}:${branch}`, per_page: 100 })
  const seen = new Map()
  for (const p of [...asBase, ...asHead]) seen.set(p.number, { number: p.number, title: p.title, url: p.html_url })
  return [...seen.values()].sort((a, b) => a.number - b.number)
}

/** The commenter's permission, 'none' for a closed epic; null when the check itself failed. */
async function permissionOf(github, repo, issue, actor, core) {
  if (issue.state === 'closed') return 'none'
  try {
    return (await github.rest.repos.getCollaboratorPermissionLevel({ ...repo, username: actor })).data.permission
  } catch (e) {
    core.info(`Permission check failed for @${actor}: ${e.message}`)
    return null
  }
}

/** The branch facts decideFreshBranch needs: the tree's branches, open PRs on it, an existing archive. */
async function branchFacts(github, repo, issue) {
  const branches = collectBranches(await loadTree(github, repo, issue))
  if (branches.length !== 1) return { branches, openPrs: [], archiveExists: false }
  const openPrs = await openPrsFor(github, repo, branches[0])
  const archiveExists = await refExists(github, repo, `heads/${ARCHIVE_PREFIX}${branches[0]}`)
  return { branches, openPrs, archiveExists }
}

async function aheadOf(github, repo, branch, core) {
  try {
    return summarizeAhead((await github.rest.repos.compareCommitsWithBasehead({ ...repo, basehead: `main...${branch}`, per_page: 100 })).data)
  } catch (e) {
    core.warning(`compare main...${branch} failed: ${e.message}`)
    return null
  }
}

/**
 * GitHub finishes a rename in the background — confirm both refs before saying it worked.
 * git.getRef, not repos.getBranch: getBranch can answer a renamed branch through a redirect.
 */
async function waitForRename(github, repo, { branch, archive }, sleep) {
  for (let waited = 0; ; waited += POLL_MS) {
    const oldThere = await refExists(github, repo, `heads/${branch}`)
    if (!oldThere && await refExists(github, repo, `heads/${archive}`)) return true
    if (waited >= POLL_LIMIT_MS) return false
    await sleep(POLL_MS)
  }
}

/** Rename and confirm; returns the failure reason, or null on success. */
async function renameBranch(github, repo, target, sleep) {
  try {
    await github.request('POST /repos/{owner}/{repo}/branches/{branch}/rename', { ...repo, branch: target.branch, new_name: target.archive })
  } catch (e) {
    return `GitHub refused the request (${e.status || ''} ${e.message}).`
  }
  return (await waitForRename(github, repo, target, sleep)) ? null : `Still not finished after ${POLL_LIMIT_MS / 1000} s.`
}

export async function runFreshBranch({ github, context, core, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => new Date() }) {
  const issue_number = context.payload.issue.number
  const actor = context.payload.comment.user.login
  const repo = context.repo
  const runUrl = `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`
  const say = body => github.rest.issues.createComment({ ...repo, issue_number, body })

  const issue = (await github.rest.issues.get({ ...repo, issue_number })).data
  const perm = await permissionOf(github, repo, issue, actor, core)
  if (perm === null) return
  const no = ignoreReason({ state: issue.state, perm })
  if (no) return core.info(`Not setting aside #${issue_number}'s branch: ${no}.`)

  const d = decideFreshBranch({ state: issue.state, perm, ...(await branchFacts(github, repo, issue)) })
  if (d.action === 'ignore') return core.info(`Not setting aside #${issue_number}'s branch: ${d.reason}.`)
  if (d.action === 'refuse') {
    await say(renderReport({ outcome: 'refused', reason: d.reason, prs: d.prs, actor, runUrl }))
    return core.info(`Refused on #${issue_number}: ${d.reason}`)
  }

  const { branch, archive } = d
  const ahead = await aheadOf(github, repo, branch, core)
  const failure = await renameBranch(github, repo, d, sleep)
  if (failure) {
    await say(renderReport({ outcome: 'failed', branch, archive, ahead, reason: failure, actor, runUrl }))
    return core.setFailed(`rename ${branch} → ${archive} not confirmed: ${failure}`)
  }

  await say(renderReport({ outcome: 'renamed', branch, archive, ahead, actor, runUrl }))
  const next = decisionsBody(issue.body, { branch, archive, date: now().toISOString().slice(0, 10) })
  if (next) await github.rest.issues.update({ ...repo, issue_number, body: next })
  core.info(`#${issue_number}: ${branch} → ${archive}; the next worker run recreates ${branch} from main.`)
}
