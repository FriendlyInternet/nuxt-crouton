// suggestions-daily.mjs — pure helpers for the daily suggestions list (#4308, epic #4223 step 1).
//
// The pipeline review's daily run reads the suggestions log (one JSON file per line on the
// `pipeline-data` branch, written by scripts/suggest.mjs), a small model groups the same idea,
// and these helpers rank the groups, render the top three as one comment and decide whether to
// post it. No I/O here — scripts/suggestions-daily.mjs does the git/gh calls.
//
// A line here is a validated suggestion plus `id` = its file path on `pipeline-data`
// (e.g. `suggestions/2026-11-20/<ts>-<rand>.json`).

import { isExpired } from './suggestions.mjs'

export const MAX_IDEAS = 3
export const MAX_TITLE = 120
export const MARKER_RE = /^<!-- suggestions-daily:v1 date=(\S+) ids=(\S*) -->/
export const POSTER = 'github-actions[bot]'
export const HEADER = '> 🤖 **pi.dev harness** · agent pipeline (CI) · _daily suggestions_'

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** The grouping prompt: the lines as `id · area · text`, asking only for JSON groups written to `outFile`. */
export function buildGroupPrompt(lines, outFile) {
  const list = lines.map((l) => `- ${l.id} · ${l.area} · ${oneLine(l.text)}`).join('\n')
  return [
    'You group improvement suggestions. Below is a list of suggestion lines, one per line, as `id · area · text`.',
    'Put lines that describe the same idea in one group. Give each group a short one-line title (at most 120 characters).',
    'Every id must appear in exactly one group. Do not invent ids.',
    '',
    'Answer ONLY with JSON of this shape, nothing else:',
    '[{ "title": "<one line>", "ids": ["<id>", "..."] }]',
    '',
    `Write that JSON (and nothing else) to the file ${outFile} with your file-write tool. Do not run any other command.`,
    '',
    'Lines:',
    list,
    '',
  ].join('\n')
}

const singleton = (l) => ({ title: oneLine(l.text), ids: [l.id] })

/** Pull the JSON array out of the model's text (tolerates a ```json fence). */
function parseJsonArray(text) {
  const s = String(text ?? '').trim()
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : s
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start < 0 || end < start) throw new Error('no JSON array found')
  const v = JSON.parse(body.slice(start, end + 1))
  if (!Array.isArray(v)) throw new Error('not an array')
  return v
}

/**
 * The model's groups → `{ groups, error }`. Every line lands in exactly one group: unknown ids
 * dropped, an id in two groups kept in the first, a missing line its own group. Unparsable text →
 * `error` set and one group per line. No lines → no groups and no error, whatever `text` is.
 */
export function parseGroups(text, lines) {
  if (!lines.length) return { groups: [], error: null }
  let raw
  try {
    raw = parseJsonArray(text)
  } catch (e) {
    return { groups: lines.map(singleton), error: `could not parse the groups: ${e.message}` }
  }
  const known = new Set(lines.map((l) => l.id))
  const seen = new Set()
  const groups = []
  for (const g of raw) {
    if (!g || typeof g !== 'object' || !Array.isArray(g.ids)) continue
    const ids = g.ids.filter((id) => typeof id === 'string' && known.has(id) && !seen.has(id))
    if (!ids.length) continue
    ids.forEach((id) => seen.add(id))
    const title = oneLine(g.title) || oneLine(lines.find((l) => l.id === ids[0]).text)
    groups.push({ title, ids })
  }
  for (const l of lines) if (!seen.has(l.id)) groups.push(singleton(l))
  return { groups, error: null }
}

const newestTs = (ls) => Math.max(...ls.map((l) => Date.parse(l.ts)))

/**
 * At most three `{ title, count, lines }`. A group is dropped when every line in it is expired
 * against the group; `count` = the group's line count; order by count desc, then newest `ts`.
 */
export function rankIdeas(lines, groups, now = new Date()) {
  const byId = new Map(lines.map((l) => [l.id, l]))
  const ideas = []
  for (const g of groups) {
    const ls = g.ids.map((id) => byId.get(id)).filter(Boolean)
    if (!ls.length) continue
    if (ls.every((l) => isExpired(l, ls, now))) continue
    ideas.push({ title: g.title, count: ls.length, lines: ls })
  }
  ideas.sort((a, b) => b.count - a.count || newestTs(b.lines) - newestTs(a.lines))
  return ideas.slice(0, MAX_IDEAS)
}

/** One line, ≤ 120 characters, `@handle` wrapped in backticks so it pings no one. */
export function cleanTitle(title) {
  let t = oneLine(title)
  if (t.length > MAX_TITLE) t = t.slice(0, MAX_TITLE - 1).trimEnd() + '…'
  return t.replace(/`/g, "'").replace(/(^|[^\w`])@([A-Za-z0-9][\w-]*(?:\/[\w.-]+)?)/g, '$1`@$2`')
}

/** The sorted line ids of the shown ideas — the marker's `ids=`. */
export const ideaIds = (top) => top.flatMap((i) => i.lines.map((l) => l.id)).sort()

/** The comment: marker, header, one numbered line per idea (never more than three). */
export function renderComment(top, { date, grouped = true, repo = 'FriendlyInternet/nuxt-crouton' } = {}) {
  const shown = top.slice(0, MAX_IDEAS)
  const out = [`<!-- suggestions-daily:v1 date=${date} ids=${ideaIds(shown).join(',')} -->`, HEADER, '', `### 💡 Suggestions — ${date}`, '']
  if (!grouped) out.push("_Today's list is not grouped — the grouping model failed, so each line counts on its own._", '')
  shown.forEach((idea, i) => {
    const areas = [...new Set(idea.lines.map((l) => l.area))].join(', ')
    const links = idea.lines
      .map((l, j) => `[evidence ${j + 1}](${l.evidence}) · [line ${j + 1}](https://github.com/${repo}/blob/pipeline-data/${l.id})`)
      .join(' · ')
    out.push(`${i + 1}. ${cleanTitle(idea.title)} — seen ${idea.count}× — ${areas} — ${links}`)
  })
  out.push('', '_Replies here start nothing yet — saying yes to one comes in a later step (#4223)._')
  return out.join('\n') + '\n'
}

const authorOf = (c) => c?.author?.login ?? c?.user?.login ?? ''

/** The marker comments the post job wrote, oldest first: `{ date, ids, at }`. */
export function markerComments(comments = []) {
  const out = []
  for (const c of comments) {
    if (authorOf(c) !== POSTER) continue
    const m = String(c.body || '').match(MARKER_RE)
    if (!m) continue
    out.push({ date: m[1], ids: m[2] ? m[2].split(',').sort() : [], at: Date.parse(c.createdAt ?? c.created_at ?? '') || 0 })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** 'post' | 'clear' | 'skip-duplicate' | 'skip-unchanged'. */
export function decidePost({ top = [], comments = [], date } = {}) {
  if (!top.length) return 'clear'
  const markers = markerComments(comments)
  if (markers.some((m) => m.date === date)) return 'skip-duplicate'
  const newest = markers[markers.length - 1]
  if (newest && newest.ids.join(',') === ideaIds(top.slice(0, MAX_IDEAS)).join(',')) return 'skip-unchanged'
  return 'post'
}
