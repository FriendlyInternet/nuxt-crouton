// The web-research question and the answer it expects (#2243). Lives on the server so the card
// ("Ask Claude" / "Paste answer") and the Mac script (scripts/research.mjs) build the very same
// question and read the answer the very same way.
import { z } from 'zod'

// Moods the agent may pick from, until the app owns a mood vocabulary of its own.
export const MOODS = 'dark, euphoric, melancholic, dreamy, groovy, sexy, playful, aggressive, hypnotic, uplifting, tense, nostalgic'

export const researchAnswerSchema = z.object({
  genres: z.array(z.object({ word: z.string(), weight: z.number().min(0).max(1), parent: z.string().nullable() })).min(1).max(6),
  moods: z.array(z.string()),
  energy: z.number().min(1).max(5),
  confidence: z.number().min(0).max(1),
  level: z.enum(['track', 'release', 'artist', 'none']),
  sources: z.array(z.object({ label: z.string(), url: z.string() })),
  note: z.string()
})
export type ResearchAnswer = z.infer<typeof researchAnswerSchema>

/** The same shape as JSON Schema, for `claude -p --json-schema`. */
export const RESEARCH_JSON_SCHEMA = z.toJSONSchema(researchAnswerSchema)

/** The answer as pasted from a chat: a bare JSON object, a ```json fence, or JSON inside prose. */
export function parseResearchAnswer(text: string): { data: ResearchAnswer } | { error: string } {
  const bad = { error: 'That doesn\'t look like Claude\'s answer — copy the whole reply' }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')
  const candidates = [fenced, from >= 0 && to > from ? text.slice(from, to + 1) : null].filter((c): c is string => !!c)
  for (const c of candidates) {
    try {
      const parsed = researchAnswerSchema.safeParse(JSON.parse(c))
      if (parsed.success) return { data: parsed.data }
    } catch {}
  }
  return bad
}

// ── Facts from the track ──────────────────────────────────────────────────────

/** Store downloads are named "<track id>_<title>.mp3"; the ID opens the exact track page. */
export function beatportId(location: string | null | undefined) {
  const file = decodeURIComponent(location ?? '').split('/').pop() ?? ''
  return file.match(/^(\d{5,})_/)?.[1] ?? null
}

/** An energy measured from the audio, written into the comment as "Energy 7" (scale 1–10). */
export function measuredEnergy(comments: string | null | undefined) {
  const n = Number((comments ?? '').match(/\benergy\s*[:-]?\s*(\d{1,2})\b/i)?.[1])
  return n >= 1 && n <= 10 ? n : null
}

const MIX_NOISE = String.raw`(?:original|extended|radio|club|album|single|clean|dirty)(?:\s+(?:mix|edit|version))?|remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?|official\s+(?:music\s+)?(?:video|audio)|lyrics?(?:\s+video)?|hq|hd`

/** A title a search engine finds: no mix/version noise, no key/BPM labels, no site names, and
 *  "feat." moved to the artist. Remixer names stay — a remix is filed by the remixer. */
export function cleanTitle(name: string | null | undefined, artist: string | null | undefined) {
  let title = name ?? ''
  let who = artist ?? ''
  title = title
    .replace(/^\s*\d{1,2}[AB]\s*-\s*\d{2,3}(?:\.\d+)?\s*-\s*/i, '') // "4A - 128 - Title"
    .replace(/\s*-\s*\d{1,2}[AB]\s*-\s*\d{2,3}(?:\.\d+)?\s*$/i, '') // "Title - 4A - 128"
    .replace(/\s*[([]?\s*(?:https?:\/\/|www\.)[^\s)\]]+\s*[)\]]?/gi, '') // "(www.site.com)"
    .replace(/\s*[([][^)\]]*\.(?:com|net|org|info|ru|io|co|me)\s*[)\]]/gi, '') // "(site.com)"
  const feat = title.match(/\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+([^)\]]+)[)\]]|\s+(?:feat\.?|ft\.?|featuring)\s+(.+?)(?=\s+[-([]|$)/i)
  if (feat) {
    const guest = (feat[1] ?? feat[2] ?? '').trim()
    title = title.replace(feat[0], '')
    if (!who.toLowerCase().includes(guest.toLowerCase())) who = who ? `${who} feat. ${guest}` : guest
  }
  title = title
    .replace(new RegExp(String.raw`\s*[([]\s*(?:${MIX_NOISE})\s*[)\]]`, 'gi'), '')
    .replace(new RegExp(String.raw`\s+-\s+(?:${MIX_NOISE})\s*$`, 'i'), '')
    .replace(/\s{2,}/g, ' ').trim()
  return { title: title || (name ?? '').trim(), artist: who.trim() }
}


export const splitArtists = (a: string | null | undefined) => (a ?? '').toLowerCase().split(/\s*(?:,|&|\/|\bfeat\.?|\bft\.?|\bvs\.?|\bx\b)\s*/).map(s => s.trim()).filter(s => s.length > 1)

export interface ResearchTrack {
  id: string
  name: string
  artist: string | null
  album?: string | null
  label?: string | null
  year?: number | string | null
  bpm?: number | null
  tonality?: string | null
  genre?: string | null
  location?: string | null
  originalComments?: string | null
}
export interface ResearchPile { id: string, name: string, parentId: string | null }
export interface ResearchOther { id: string, artist: string | null, name: string, tags: string[] }

/** The full question for one track: its facts, the DJ's piles, and how he filed the same artist. */
export function buildResearchPrompt(track: ResearchTrack, piles: ResearchPile[], others: ResearchOther[]) {
  const byId = new Map(piles.map(p => [p.id, p]))
  const byName = new Map(piles.map(p => [p.name.toLowerCase(), p]))
  const path = (p: ResearchPile): string => p.parentId && byId.get(p.parentId) ? `${path(byId.get(p.parentId)!)} › ${p.name}` : p.name
  const pileList = piles.map(path).sort().join('\n')
  const mine = new Set(splitArtists(track.artist))
  const filed = others
    .filter(o => o.id !== track.id && splitArtists(o.artist).some(a => mine.has(a)))
    .map(o => ({ o, ps: o.tags.map(t => byName.get(t.toLowerCase())).filter((p): p is ResearchPile => !!p) }))
    .filter(x => x.ps.length)
    .slice(0, 8)
    .map(({ o, ps }) => `- ${o.artist} – ${o.name}: ${ps.map(path).join('; ')}`)
    .join('\n')

  const clean = cleanTitle(track.name, track.artist)
  const id = beatportId(track.location)
  const energy = measuredEnergy(track.originalComments)
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
  const trackBlock = filed ? `${facts}\n\nHow the DJ already filed other tracks by this artist (follow it unless this track clearly sounds different):\n${filed}` : facts
  // Function replacers: a "$&" in a title must not be read as a replacement pattern.
  const prompt = RESEARCH_PROMPT
    .replace('{{track}}', () => trackBlock).replace('{{moods}}', () => MOODS).replace('{{piles}}', () => pileList)
  return { prompt, energy }
}

/** The agent's answer as a lookup result the hints already understand (words in `styles`). */
export function toTip(a: ResearchAnswer, measured: number | null) {
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

export const RESEARCH_PROMPT = `You are helping a DJ file one track from his record collection. Research it on the web the way a
well-read DJ would, then answer with JSON only.

## The track
{{track}}

## How to research
Artists change sound from track to track, so **what is written about this exact track or its
release is the evidence; what is written about the artist is only a weak hint.**

1. If the facts above give a **Beatport track ID**, open \`https://www.beatport.com/track/-/<id>\`
   first. That page is this exact track, so its genre counts as \`level: "track"\` and you need no
   search to find it. Then go on to the others below only to confirm or add.
2. Look for the track itself, in this order: Bandcamp (search \`"<title>" <artist> bandcamp\`, and
   try \`<artist>.bandcamp.com\` and the label's Bandcamp), the label's own page, Discogs (the
   release, and the track's row on it), Beatport / Juno / Traxsource / Boomkat (their per-release
   genre and blurb), reviews or premieres of this track or release (RA, Mixmag, DJ Mag, Bandcamp
   Daily, blogs). A remix is filed by the **remixer's** take on it, so look for the remix itself.
3. Use the facts you already have: the BPM, key, year, label and rekordbox genre field above.
   They are real and beat any artist bio: 95 BPM is not trance, 170 is not house.
   The title above has been cleaned for searching; if a search finds nothing, try the original
   title too.
4. Only when nothing about the track or release turns up, fall back to the artist, and then:
   keep every genre weight at 0.4 or below, confidence at 0.4 or below, \`level: "artist"\`, and say
   in the note what is unknown.
5. Do at most ~8 searches and open at most ~5 pages. Stop as soon as the track's own pages
   agree.
6. Never invent sources. Every URL you return must be a page you actually saw, and the label
   says what it is about ("Bandcamp – this track", "RA review – the EP", "Bio – artist").

## What to answer
**Genres** — words that describe how it sounds, most specific first, 2–6 of them. Use the DJ's
own pile names (below) **exactly as written** whenever one fits; add your own word only when no
pile fits (e.g. a scene name like "speed dembow"). For each, give where it should live: the
existing pile it belongs inside (\`parent\`), or null when it is itself a pile.

**Moods** — 1–3 words from this list only: {{moods}}

**Energy** — 1 (warm-up, sit-down) to 5 (peak time). If the facts above give a **measured
energy**, answer exactly that number: it was measured from the audio and beats anything written
online. Only when there is no measured energy, judge it yourself, and say in the note that the
energy is your guess.

**Confidence** — 0–1 for the genres as a whole: 0.9+ when the track's own page says it, ~0.7
from its release, 0.4 or below from the artist or label alone.

## The DJ's piles (parent › child)
{{piles}}

## Output — JSON only, no prose, no code fence
{"genres":[{"word":"…","weight":0.0-1.0,"parent":"pile name or null"}],"moods":["…"],"energy":1-5,"confidence":0.0-1.0,"level":"track|release|artist","sources":[{"label":"Bandcamp","url":"https://…"}],"note":"one short sentence a DJ would find useful"}
`

