#!/usr/bin/env node
// owner-screens.mjs — "is this comment the owner answering from one of our screens?" (#3691)
//
// WHY. The owner answers some holds from a screen we built, not by typing a comment: the
// diagram editor (📐 a saved drawing) and the preview overlay (🎯 preview feedback). Both post
// through the Nuxt Harness GitHub App — the SAME app the pipeline posts as — so the bot filters
// that keep the pipeline from waking itself also dropped the owner's answers. The visible emoji
// on the first line is what tells an owner-screen comment apart from the pipeline's own posts
// (those open with `<!--` or `> 🤖`). This module is the ONE definition; the workflow `if:`
// copies of the emoji set and slug are pinned to it by scripts/on-comment-bot-filter.test.mjs.
//
// An owner-screen comment is FEEDBACK, never an approval: approval.mjs refuses it.
//
// Node core only. Pure except `sourceIssueFor` (takes the issue fetcher) and `readDiagramScene` (runs git).

import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

/** The screens. `reserved` ones are recognised now so a later screen needs no filter change. */
export const OWNER_SCREENS = [
  { emoji: '🎯', screen: 'preview-feedback', status: 'live' },
  { emoji: '📐', screen: 'diagram-save', status: 'live' },
  { emoji: '🚶', screen: 'step-walk', status: 'reserved' },
  { emoji: '🗳', screen: 'quiz', status: 'reserved' },
]

/** App slugs allowed to post owner-screen comments (the ticket-editor + the crouton-feedback bridge). */
export const OWNER_SCREEN_APPS = ['nuxt-harness']

/**
 * The owner-screen emoji the comment opens with, or null. Only the START of the first non-empty
 * line counts, so a quote (`> 📐 …`) or a mention mid-sentence never matches. `startsWith` lets
 * `🗳️` (with U+FE0F) and skin-tone variants of 🚶 match too.
 * @param {string} body
 * @returns {string|null}
 */
export function ownerScreenEmoji(body) {
  const first = String(body || '').split('\n').find(l => l.trim()) || ''
  const hit = OWNER_SCREENS.find(s => first.startsWith(s.emoji))
  return hit ? hit.emoji : null
}

/** Is the comment from an allowed app? `appSlug` (performed_via_github_app.slug) or the `<slug>[bot]` login. */
function fromOwnerScreenApp(comment = {}) {
  if (comment.appSlug && OWNER_SCREEN_APPS.includes(comment.appSlug)) return true
  return OWNER_SCREEN_APPS.some(s => comment.userLogin === `${s}[bot]`)
}

/**
 * Posted by one of our apps AND opens with an owner-screen emoji. No label check — used where the
 * hold label may already be gone (the answer payload runs after the design-hold step).
 * @param {{comment: {body?:string, appSlug?:string|null, userLogin?:string}}} input
 */
export function isOwnerScreenSource({ comment = {} } = {}) {
  return fromOwnerScreenApp(comment) && ownerScreenEmoji(comment.body) !== null
}

/**
 * An owner-screen comment on a WAITING item. On an issue, the issue carries `status:blocked`.
 * On a PR the hold label sits on the PR's SOURCE issue (its `Closes #N`), not on the PR — held
 * drafts carry no `status:blocked` themselves — so a PR needs `pr.sourceIssue` (see
 * `sourceIssueFor`) and THAT issue must be blocked; the PR's own labels don't count.
 * @param {{comment: object, issue: {isPr?: boolean, labels?: string[]}, pr?: {sourceIssue?: {labels?: string[]}|null}}} input
 */
export function isOwnerScreenComment({ comment = {}, issue = {}, pr } = {}) {
  if (!isOwnerScreenSource({ comment })) return false
  const labels = issue.isPr ? (pr?.sourceIssue?.labels || []) : (issue.labels || [])
  return labels.includes('status:blocked')
}

/** The PR's source issue: the first `Closes #N` in its body, in prose only (not code). Else null. */
export function linkedIssueNumber(prBody) {
  const prose = String(prBody || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  const m = /\bCloses\s+#(\d+)/i.exec(prose)
  return m ? Number(m[1]) : null
}

/**
 * Resolve a PR's source issue `{number, labels}` for an owner-screen comment, else null. Fetches
 * only when the comment IS an owner-screen comment, so ordinary comments cost no API call.
 * @param {{comment: object, prBody?: string, getIssue: (n: number) => Promise<{labels?: Array<string|{name:string}>}>}} input
 */
export async function sourceIssueFor({ comment = {}, prBody, getIssue } = {}) {
  if (!isOwnerScreenSource({ comment })) return null
  const number = linkedIssueNumber(prBody)
  if (!number) return null
  const issue = await getIssue(number)
  return { number, labels: (issue?.labels || []).map(l => (typeof l === 'string' ? l : l.name)) }
}

const DIAGRAM_LINE = /<!--\s*owner-screen:diagram\s+slug=(\S+)\s+branch=(\S+)\s+sha=(\S*)\s+path=(\S+)\s*-->/

/** The ticket-editor's hidden save line → `{slug, branch, sha, path}`, or null. */
export function parseDiagramSave(body) {
  const m = DIAGRAM_LINE.exec(String(body || ''))
  return m ? { slug: m[1], branch: m[2], sha: m[3], path: m[4] } : null
}

/** The hidden line `parseDiagramSave` reads — written by the ticket-editor. */
export function diagramSaveLine({ slug, branch, sha, path }) {
  return `<!-- owner-screen:diagram slug=${slug} branch=${branch} sha=${sha || ''} path=${path} -->`
}

/**
 * The saved scene at `sha`. The resume job checks out ONE commit of main, and the editor saves on
 * the ticket's branch — so fetch that commit first (`git fetch --depth=1 origin <sha>`), then read
 * it. Returns the file text, or null when the sha/path is missing or the read fails.
 * @param {{sha?: string, path?: string}} diagram
 * @param {{cwd?: string, remote?: string}} [opts]
 */
export function readDiagramScene({ sha, path } = {}, { cwd = process.cwd(), remote = 'origin' } = {}) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(sha || '')) || !path || path.startsWith('-')) return null
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  try {
    try { git('cat-file', '-e', `${sha}^{commit}`) } catch { git('fetch', '--depth=1', '--no-tags', remote, sha) }
    return git('show', `${sha}:${path}`)
  } catch { return null }
}

// CLI: `node scripts/lib/owner-screens.mjs --is-source <body-file> <app-slug>` → exit 0 when the
// comment is an owner-screen comment from an allowed app, else 1 (used by work-issue-pidev.yml).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [flag, file, slug] = process.argv.slice(2)
  if (flag !== '--is-source' || !file) {
    console.error('usage: owner-screens.mjs --is-source <body-file> <app-slug>')
    process.exit(2)
  }
  const { readFileSync } = await import('node:fs')
  let body = ''
  try { body = readFileSync(file, 'utf8') } catch { process.exit(1) }
  process.exit(isOwnerScreenSource({ comment: { body, appSlug: slug || null } }) ? 0 : 1)
}
