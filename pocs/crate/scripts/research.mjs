#!/usr/bin/env node
// Crate research agent (#2229) — look up up to 100 inbox tracks per run on the web, as a DJ would.
//
//   node pocs/crate/scripts/research.mjs [--limit 100] [--url …] [--model sonnet] [--dry-run]
//
// For each inbox track without a research tip yet: clean the title for searching, add what we
// already know (BPM, key, label, a Beatport ID in the file name, a measured energy, and how the
// DJ filed other tracks by this artist), let `claude -p` research it with web search, and upload
// the answer as the track's "Agent" tip — next to the Discogs/Bandcamp/"sounds like" tips.
// Runs on the Claude subscription; keep --limit small so a day's usage stays modest.
//
// Env (pocs/crate/.env): CRATE_EMAIL, CRATE_PASSWORD, optional CRATE_URL.
import { readFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = dirname(fileURLToPath(import.meta.url))
const envFile = join(here, '..', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const { values: args } = parseArgs({
  options: {
    'url': { type: 'string', default: process.env.CRATE_URL || 'https://crate-staging.pmcp.dev' },
    'limit': { type: 'string', default: '100' },
    'model': { type: 'string', default: 'sonnet' },
    'parallel': { type: 'string', default: '3' },
    'team': { type: 'string' },
    'dry-run': { type: 'boolean', default: false }
  }
})

// Moods the agent may pick from, until the app owns a mood vocabulary of its own.
const MOODS = 'dark, euphoric, melancholic, dreamy, groovy, sexy, playful, aggressive, hypnotic, uplifting, tense, nostalgic'

const SCHEMA = JSON.stringify({
  type: 'object',
  required: ['genres', 'moods', 'energy', 'confidence', 'level', 'sources', 'note'],
  properties: {
    genres: { type: 'array', items: { type: 'object', required: ['word', 'weight', 'parent'], properties: { word: { type: 'string' }, weight: { type: 'number' }, parent: { type: ['string', 'null'] } } } },
    moods: { type: 'array', items: { type: 'string' } },
    energy: { type: 'number' },
    confidence: { type: 'number' },
    level: { type: 'string', enum: ['track', 'release', 'artist', 'none'] },
    sources: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } } } },
    note: { type: 'string' }
  }
})

// ── Facts from the track ──────────────────────────────────────────────────────

/** Store downloads are named "<track id>_<title>.mp3"; the ID opens the exact track page. */
export function beatportId(location) {
  const file = decodeURIComponent(location ?? '').split('/').pop() ?? ''
  return file.match(/^(\d{5,})_/)?.[1] ?? null
}

/** An energy measured from the audio, written into the comment as "Energy 7" (scale 1–10). */
export function measuredEnergy(comments) {
  const n = Number((comments ?? '').match(/\benergy\s*[:-]?\s*(\d{1,2})\b/i)?.[1])
  return n >= 1 && n <= 10 ? n : null
}

const MIX_NOISE = String.raw`(?:original|extended|radio|club|album|single|clean|dirty)(?:\s+(?:mix|edit|version))?|remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?|official\s+(?:music\s+)?(?:video|audio)|lyrics?(?:\s+video)?|hq|hd`

/** A title a search engine finds: no mix/version noise, no key/BPM labels, no site names, and
 *  "feat." moved to the artist. Remixer names stay — a remix is filed by the remixer. */
export function cleanTitle(name, artist) {
  let title = name ?? ''
  let who = artist ?? ''
  title = title
    .replace(/^\s*\d{1,2}[AB]\s*-\s*\d{2,3}(?:\.\d+)?\s*-\s*/i, '') // "4A - 128 - Title"
    .replace(/\s*-\s*\d{1,2}[AB]\s*-\s*\d{2,3}(?:\.\d+)?\s*$/i, '') // "Title - 4A - 128"
    .replace(/\s*[([]?\s*(?:https?:\/\/|www\.)[^\s)\]]+\s*[)\]]?/gi, '') // "(www.site.com)"
    .replace(/\s*[([][^)\]]*\.(?:com|net|org|info|ru|io|co|me)\s*[)\]]/gi, '') // "(site.com)"
  const feat = title.match(/\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+([^)\]]+)[)\]]|\s+(?:feat\.?|ft\.?|featuring)\s+(.+?)(?=\s+[-([]|$)/i)
  if (feat) {
    const guest = (feat[1] ?? feat[2]).trim()
    title = title.replace(feat[0], '')
    if (!who.toLowerCase().includes(guest.toLowerCase())) who = who ? `${who} feat. ${guest}` : guest
  }
  title = title
    .replace(new RegExp(String.raw`\s*[([]\s*(?:${MIX_NOISE})\s*[)\]]`, 'gi'), '')
    .replace(new RegExp(String.raw`\s+-\s+(?:${MIX_NOISE})\s*$`, 'i'), '')
    .replace(/\s{2,}/g, ' ').trim()
  return { title: title || (name ?? '').trim(), artist: who.trim() }
}

// ── The app ───────────────────────────────────────────────────────────────────

async function login() {
  const res = await fetch(`${args.url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': args.url },
    body: JSON.stringify({ email: process.env.CRATE_EMAIL, password: process.env.CRATE_PASSWORD })
  })
  if (!res.ok) throw new Error(`Login failed: ${res.status}`)
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  return async (path, init = {}) => {
    const r = await fetch(`${args.url}${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'Origin': args.url, cookie, ...init.headers } })
    if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${r.status} ${await r.text()}`)
    return r.json()
  }
}

const splitArtists = a => (a ?? '').toLowerCase().split(/\s*(?:,|&|\/|\bfeat\.?|\bft\.?|\bvs\.?|\bx\b)\s*/).map(s => s.trim()).filter(s => s.length > 1)

function filingContext(lib) {
  const byId = new Map(lib.piles.map(p => [p.id, p]))
  const byName = new Map(lib.piles.map(p => [p.name.toLowerCase(), p]))
  const path = p => p.parentId && byId.get(p.parentId) ? `${path(byId.get(p.parentId))} › ${p.name}` : p.name
  const piles = lib.piles.map(path).sort().join('\n')
  /** How the DJ filed other tracks by this track's artists — the strongest hint of where *he* puts this sound. */
  const ownFiling = (track) => {
    const mine = new Set(splitArtists(track.artist))
    return lib.tracks
      .filter(o => o.id !== track.id && splitArtists(o.artist).some(a => mine.has(a)))
      .map(o => ({ o, ps: o.tags.map(t => byName.get(t.toLowerCase())).filter(Boolean) }))
      .filter(x => x.ps.length)
      .slice(0, 8)
      .map(({ o, ps }) => `- ${o.artist} – ${o.name}: ${ps.map(path).join('; ')}`)
      .join('\n')
  }
  return { piles, ownFiling }
}

function promptFor(track, ctx) {
  const clean = cleanTitle(track.name, track.artist)
  const id = beatportId(track.location)
  const energy = measuredEnergy(track.comments)
  const facts = [
    `Title: ${clean.title}`,
    clean.title !== track.name && `Original title: ${track.name}`,
    `Artist: ${clean.artist}`,
    track.album && `Album: ${track.album}`,
    track.label && `Label: ${track.label}`,
    track.year && `Year: ${track.year}`,
    track.bpm && `BPM: ${Math.round(track.bpm)}`,
    track.tonality && `Key: ${track.tonality}`,
    track.genre && `Genre field in rekordbox: ${track.genre}`,
    id && `Beatport track ID: ${id}`,
    energy && `Measured energy: ${Math.max(1, Math.min(5, Math.round(energy / 2)))} (measured ${energy} on a 1–10 scale)`
  ].filter(Boolean).join('\n')
  const filed = ctx.ownFiling(track)
  const track_ = filed ? `${facts}\n\nHow the DJ already filed other tracks by this artist (follow it unless this track clearly sounds different):\n${filed}` : facts
  return {
    prompt: readFileSync(join(here, 'research-prompt.md'), 'utf8')
      .replace('{{track}}', track_).replace('{{moods}}', MOODS).replace('{{piles}}', ctx.piles),
    energy
  }
}

function research(prompt) {
  return new Promise((resolve) => {
    const cli = ['-p', prompt, '--model', args.model, '--output-format', 'json', '--json-schema', SCHEMA, '--allowedTools', 'WebSearch,WebFetch']
    // Run outside the repo so the agent doesn't pick up this project's instructions.
    execFile('claude', cli, { maxBuffer: 1e8, cwd: tmpdir(), timeout: 300_000 }, (err, out) => {
      let r = {}
      try { r = JSON.parse(out) } catch {}
      resolve({ answer: r.structured_output ?? null, cost: r.total_cost_usd ?? 0, error: err?.message?.slice(0, 200) })
    })
  })
}

/** The agent's answer as a lookup result the hints already understand (words in `styles`). */
function toTip(a, measured) {
  const energy = measured ? Math.max(1, Math.min(5, Math.round(measured / 2))) : a.energy
  return {
    level: a.level,
    styles: a.genres.map(g => [g.word, Math.round(g.weight * 100) / 100]),
    parents: Object.fromEntries(a.genres.filter(g => g.parent).map(g => [g.word, g.parent])),
    moods: a.moods,
    energy,
    energyMeasured: !!measured,
    confidence: a.confidence,
    note: a.note,
    sources: a.sources,
    url: a.sources[0]?.url ?? null
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

const api = await login()
const teams = await api('/api/auth/organization/list')
const team = teams.find(t => !args.team || [t.slug, t.id].includes(args.team)) ?? teams[0]
const base = `/api/teams/${team.id}/crate`
const [lib, queue] = await Promise.all([api(`${base}/library`), api(`${base}/research-queue?limit=${Number(args.limit)}`)])
const ctx = filingContext(lib)
console.log(`${queue.length} inbox tracks to research (limit ${args.limit})`)

if (args['dry-run']) {
  for (const t of queue.slice(0, 3)) {
    const { title, artist } = cleanTitle(t.name, t.artist)
    console.log(`\n${t.artist} – ${t.name}\n  → ${artist} – ${title}  · beatport ${beatportId(t.location) ?? '-'} · energy ${measuredEnergy(t.comments) ?? '-'}`)
  }
  if (queue[0]) console.log(`\n── prompt for the first track ──\n${promptFor(queue[0], ctx).prompt}`)
  process.exit(0)
}

let uploaded = 0, cost = 0, failed = 0
const parallel = Number(args.parallel)
for (let i = 0; i < queue.length; i += parallel) {
  const batch = queue.slice(i, i + parallel)
  const answers = await Promise.all(batch.map(async (t) => {
    const { prompt, energy } = promptFor(t, ctx)
    const r = await research(prompt)
    cost += r.cost
    if (!r.answer) {
      failed++
      console.log(`  ✗ ${t.artist} – ${t.name}: ${r.error ?? 'no answer'}`)
      return null
    }
    console.log(`  ✓ ${t.artist} – ${t.name}: ${r.answer.genres.map(g => g.word).join(', ')} [${r.answer.level}]`)
    return { trackId: t.id, result: toTip(r.answer, energy) }
  }))
  const tips = answers.filter(Boolean)
  // Upload per batch, so a stopped run keeps what it already found.
  if (tips.length) uploaded += (await api(`${base}/tips`, { method: 'POST', body: JSON.stringify({ source: 'Agent', tips }) })).tipsMerged
}
console.log(`Researched ${uploaded} tracks, ${failed} failed · ~$${cost.toFixed(2)} of subscription usage`)
