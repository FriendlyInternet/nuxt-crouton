#!/usr/bin/env node
/**
 * Read the OUTSIDE reviewer's answer on a PR (#4318) — the review asked by qodo-second-opinion.yml.
 *
 * The build review used to ignore it, so real bugs the outside reviewer named still merged. This
 * PURE parser turns a PR's comments into one state for the head commit:
 *
 *   answered — a review stamped with `/commit/<sha>`; `high` lists its High findings
 *   paused    — the "reviews are paused" reply (`<!-- qodo:billing-blocked -->`)
 *   asked     — our `<!-- qodo-asked-sha:<sha> -->` ask, no answer yet; `late` past OUTSIDE_REVIEW_WAIT_MIN
 *   none      — never asked for this commit
 *
 * TRUST: only exact bot authors count (user.type Bot + exact login) — the repo is public and the
 * review text already appears in other people's comments. Never the loose `isQodo` (/qodo/i).
 *
 *   node scripts/lib/outside-review.mjs <comments.json> <sha>   → JSON on stdout
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Slowest first answer measured over 98 asks was 11.7 min (p99 7.3); 30 is about 2.5× that. */
export const OUTSIDE_REVIEW_WAIT_MIN = 30
export const OUTSIDE_REVIEWER = 'qodo-code-review[bot]'
export const ASKER = 'nuxt-harness[bot]'

const REVIEW_HEAD = 'Code Review by Qodo'
const PAUSED = '<!-- qodo:billing-blocked -->'
const HIGH_START = 'alt="Action required"'
const HIGH_END = /badge\/Medium-|badge\/Low-|View medium \(|View low \(/

/** True only for a Bot account with exactly this login (case-insensitive). */
export const byBot = (c, login) =>
  c?.user?.type === 'Bot' && String(c?.user?.login || '').toLowerCase() === login.toLowerCase()

const decode = (s) => s
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** PURE. High findings of one review body → [{ id: 'Q<n>', title, file }]. */
export function highFindings(body) {
  const text = String(body || '')
  const start = text.indexOf(HIGH_START)
  if (start < 0) return []
  let slice = text.slice(start + HIGH_START.length)
  const end = slice.search(HIGH_END)
  if (end >= 0) slice = slice.slice(0, end)
  const heads = [...slice.matchAll(/<summary>\s*(\d+)\.\s*([\s\S]*?)<\/summary>/g)]
  return heads.map((m, i) => {
    const title = decode(m[2].replace(/<code>[\s\S]*?<\/code>/g, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    const part = slice.slice(m.index, heads[i + 1]?.index ?? slice.length)
    const focus = part.indexOf('## Fix Focus Areas')
    const f = focus >= 0 ? part.slice(focus).match(/^>?\s*-\s+(\S+?)\[/m) : null
    return { id: `Q${m[1]}`, title, file: f ? f[1] : '' }
  })
}

const when = (c) => Date.parse(c.created_at || c.updated_at || '') || 0

/** PURE. PR comments (may be `[[…]]` from gh --slurp) → the outside review's state for `sha`. */
export function outsideReview(comments, { sha, now = Date.now() } = {}) {
  const all = (comments || []).flat(Infinity).filter(Boolean)
  const reviewer = all.filter((c) => byBot(c, OUTSIDE_REVIEWER))
  const asker = all.filter((c) => byBot(c, ASKER))
  const s = String(sha || '')
  const review = s ? reviewer.filter((c) => (c.body || '').includes(REVIEW_HEAD) && (c.body || '').includes(`/commit/${s}`)).pop() : null
  if (review) return { state: 'answered', sha: s, high: highFindings(review.body), reviewUrl: review.html_url || '' }
  if (reviewer.some((c) => (c.body || '').includes(PAUSED))) return { state: 'paused', sha: s, high: [] }
  const ask = s ? asker.filter((c) => (c.body || '').includes(`<!-- qodo-asked-sha:${s} -->`)).sort((a, b) => when(a) - when(b)).pop() : null
  if (ask) {
    const askedAt = ask.created_at || ask.updated_at || ''
    return { state: 'asked', sha: s, high: [], askedAt, late: now - when(ask) > OUTSIDE_REVIEW_WAIT_MIN * 60_000 }
  }
  return { state: 'none', sha: s, high: [] }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, sha] = process.argv.slice(2)
  let comments = []
  try { comments = JSON.parse(readFileSync(file, 'utf8') || '[]') } catch (e) { console.error(`outside-review: ${e.message}`) }
  process.stdout.write(`${JSON.stringify(outsideReview(comments, { sha }))}\n`)
  process.exit(0)
}
