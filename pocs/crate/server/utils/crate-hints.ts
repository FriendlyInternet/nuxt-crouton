// Genre hints (#2212): map Discogs/Bandcamp words onto the owner's piles.
// Two signals, per brief §5: a direct name match (incl. parts of combined pile names + aliases)
// and a mapping learned from already-tagged tracks — lift P(pile|word) − P(pile), so catch-all
// tags can't win — only for words seen on ≥3 tracks. Each word is weighted by how much we
// trust where it came from.
import { eq } from 'drizzle-orm'
import { crateLookups, cratePiles, crateTracks } from '~~/server/db/schema'

interface LookupResult { source: string, level?: string, verified?: boolean, styles?: [string, number][], genres?: [string, number][], url?: string, match?: string }
interface Pile { id: string, name: string, parentId: string | null }
interface Word { word: string, key: string, trust: number }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Words that should land on a pile whose name they don't contain.
const ALIASES: Record<string, string> = {
  hiphop: 'hiphop', rap: 'hiphop',
  drumnbass: 'dnb', drumandbass: 'dnb',
  ukgarage: 'ukgarage', speedgarage: 'ukgarage', '2step': 'ukgarage',
  shaabi: 'arabic', postshaabi: 'arabic', mahraganat: 'arabic', rai: 'arabic', maqsoum: 'arabic',
  afrobeat: 'afro', afrohouse: 'afro', african: 'afro'
}

/** How much a source's words count: Discogs track-level and the audio votes 1 (their weights
 *  already carry the doubt), Bandcamp verified by track 0.8, else 0.5. */
const trustOf = (r: LookupResult) => r.source === 'Audio' || (r.source === 'Discogs' && r.level === 'track') ? 1 : r.source === 'Bandcamp' && r.verified ? 0.8 : 0.5

/** Every genre word of a lookup, with its trust (broad Discogs genres count half). */
export function wordsOf(results: LookupResult[]): Word[] {
  return results.flatMap(r => [
    ...(r.styles ?? []).map(([word, w]) => ({ word, key: norm(word), trust: trustOf(r) * w })),
    ...(r.genres ?? []).map(([word, w]) => ({ word, key: norm(word), trust: trustOf(r) * w * 0.5 }))
  ])
}

/** A pile's name keys: the whole name plus each part of a combined one ("Hardstyle & Hardcore"). */
function pileKeys(piles: Pile[]) {
  const byKey = new Map<string, Pile>()
  for (const p of piles) {
    for (const part of [p.name, ...p.name.split(/\s*(?:&|\/|,|\band\b)\s*/i)]) {
      const k = norm(part)
      if (k && !byKey.has(k)) byKey.set(k, p)
    }
  }
  return byKey
}

export interface HintModel {
  /** A pile actually named this (or a part of a combined name) — tapping the word toggles it. */
  exactPile: (key: string) => Pile | undefined
  /** Exact, else the pile an alias points at (rap → Hiphop) — counts as a direct match for scoring. */
  directPile: (key: string) => Pile | undefined
  learned: Map<string, Map<string, number>>
}

interface Counts { tracks: number, words: Map<string, number>, piles: Map<string, number>, pairs: Map<string, Map<string, number>> }

const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1)

/** How often each word, each pile, and each (word, pile) pair occur across tagged tracks. */
function countCooccurrence(piles: Pile[], tagged: { tags: string[], results: LookupResult[] }[]): Counts {
  const pileByName = new Map(piles.map(p => [p.name.toLowerCase(), p.id]))
  const c: Counts = { tracks: 0, words: new Map(), piles: new Map(), pairs: new Map() }
  for (const t of tagged) {
    const pileIds = new Set(t.tags.map(tag => pileByName.get(tag.toLowerCase())).filter((id): id is string => !!id))
    if (!pileIds.size) continue
    c.tracks++
    pileIds.forEach(id => bump(c.piles, id))
    for (const key of new Set(wordsOf(t.results).map(w => w.key))) {
      bump(c.words, key)
      const pairs = c.pairs.get(key) ?? new Map<string, number>()
      pileIds.forEach(id => bump(pairs, id))
      c.pairs.set(key, pairs)
    }
  }
  return c
}

/** Lift P(pile|word) − P(pile) for words seen on ≥3 tracks; only positive lifts are kept. */
function lifts(c: Counts) {
  const learned = new Map<string, Map<string, number>>()
  const n = Math.max(1, c.tracks)
  for (const [key, pairs] of c.pairs) {
    const seen = c.words.get(key)!
    if (seen < 3) continue
    const out = new Map<string, number>()
    for (const [id, both] of pairs) {
      const lift = both / seen - (c.piles.get(id) ?? 0) / n
      if (lift > 0) out.set(id, lift)
    }
    learned.set(key, out)
  }
  return learned
}

/** Learn word → pile lift from tracks that are both tagged and looked up. */
export function buildModel(piles: Pile[], tagged: { tags: string[], results: LookupResult[] }[]): HintModel {
  const byKey = pileKeys(piles)
  return {
    exactPile: key => byKey.get(key),
    directPile: key => byKey.get(key) ?? byKey.get(ALIASES[key] ?? ''),
    learned: lifts(countCooccurrence(piles, tagged))
  }
}

export interface PileScore { pileId: string, score: number, via: string }

/** Per pile: the best (trust × match) over the track's words, remembering which word did it. */
export function scorePiles(model: HintModel, words: Word[]): PileScore[] {
  const best = new Map<string, PileScore>()
  const offer = (pileId: string, score: number, via: string) => {
    if (score > (best.get(pileId)?.score ?? 0)) best.set(pileId, { pileId, score, via })
  }
  for (const w of words) {
    const direct = model.directPile(w.key)
    if (direct) offer(direct.id, w.trust, w.word)
    for (const [pileId, lift] of model.learned.get(w.key) ?? []) offer(pileId, w.trust * lift, w.word)
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}

// The model only changes as tracks get tagged; recompute at most once a minute per team.
const cache = new Map<string, { at: number, model: HintModel, piles: Pile[] }>()

export async function hintModel(teamId: string) {
  const hit = cache.get(teamId)
  if (hit && Date.now() - hit.at < 60_000) return hit
  const db = useDB()
  const [piles, rows] = await Promise.all([
    db.select({ id: cratePiles.id, name: cratePiles.name, parentId: cratePiles.parentId }).from(cratePiles).where(eq(cratePiles.teamId, teamId)),
    db.select({ tags: crateTracks.tags, results: crateLookups.results }).from(crateLookups)
      .innerJoin(crateTracks, eq(crateTracks.id, crateLookups.trackId)).where(eq(crateLookups.teamId, teamId))
  ]) as [Pile[], { tags: string[] | null, results: LookupResult[] | null }[]]
  const tagged = rows.map(r => ({ tags: r.tags ?? [], results: r.results ?? [] })).filter(r => r.tags.some(t => t !== 'NEW'))
  const entry = { at: Date.now(), model: buildModel(piles, tagged), piles }
  cache.set(teamId, entry)
  return entry
}

/** "Discogs (Ends Meet)" = the release's styles; "Bandcamp (artist)" = the artist's tags. */
export function sourceLabel(r: LookupResult) {
  if (r.source === 'Audio') return 'Sounds like'
  if (r.source === 'Discogs') return r.level === 'track' && r.match?.includes(' - ') ? `Discogs (${r.match.split(' - ').slice(1).join(' - ')})` : 'Discogs (artist)'
  return r.verified ? 'Bandcamp (artist, via track)' : 'Bandcamp (artist)'
}

/** Where a not-yet-existing pile for `key` most likely belongs: its alias target, else its strongest learned pile. */
export function guessParent(model: HintModel, key: string): string | null {
  const alias = model.directPile(key)
  if (alias) return alias.id
  // Only a clear learned link — a weak one sends broad words ("Electronic") somewhere arbitrary.
  const [top] = [...(model.learned.get(key) ?? [])].sort((a, b) => b[1] - a[1])
  return top && top[1] >= 0.35 ? top[0] : null
}
