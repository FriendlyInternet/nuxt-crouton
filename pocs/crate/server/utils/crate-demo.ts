// Staging demo library (#3299): a fresh staging site opens with a few piles and inbox tracks, so
// swiping, filing and "Sounds like" tips (#2230) can be tried on a phone with no setup.
// Only runs when runtimeConfig.crateDemoSeed is on (NUXT_CRATE_DEMO_SEED=true — staging's wrangler
// vars, or local dev). Idempotent: piles seed only into an empty tree, tracks upsert-ignore by
// rekordboxId, and a team that already has tracks is left alone — owner-made piles are never touched.
import { eq } from 'drizzle-orm'
import { blob } from 'hub:blob'
import { crateTracks, cratePiles } from '~~/server/db/schema'
import { seedPiles, mergeLookupSource, type ImportAudit, type PileIn } from '~~/server/utils/crate-import'
import { BLOB_PREFIX, UPLOAD_ID_PREFIX } from '~~/server/utils/crate-uploads'

export const demoSeedEnabled = () => {
  const v = (useRuntimeConfig() as { crateDemoSeed?: unknown }).crateDemoSeed
  return v === true || v === 'true' || !!import.meta.dev
}

const PILES: PileIn[] = [
  { key: 'house', name: 'House', order: 0 },
  { key: 'deep', name: 'Deep House', parentKey: 'house', order: 0 },
  { key: 'techno', name: 'Techno', order: 1 },
  { key: 'disco', name: 'Disco & Funk', order: 2 },
  { key: 'hiphop', name: 'Hiphop', order: 3 }
]

// `hz` set → a short generated tone is stored so the card can play; `tip` → a "Sounds like" row.
const TRACKS = [
  { id: 'demo-1', name: 'Midnight Loop', artist: 'Demo Artist', genre: 'House', bpm: 124, tonality: '8A', durationSec: 4, hz: 220, tip: [['House', 0.8], ['Deep House', 0.6]] },
  { id: 'demo-2', name: 'Warehouse Pulse', artist: 'Demo Artist', genre: 'Techno', bpm: 132, tonality: '5A', durationSec: 4, hz: 330, tip: [['Techno', 0.9]] },
  { id: 'demo-3', name: 'Sunday Groove', artist: 'Sample Band', genre: 'Funk', bpm: 112, tonality: '10B', durationSec: 4, hz: 440, tip: [['Disco', 0.7], ['Funk', 0.5]] },
  { id: 'demo-4', name: 'Late Bus Home', artist: 'Sample Band', genre: 'Hip Hop', bpm: 90, tonality: '3A', durationSec: 200 },
  { id: 'demo-5', name: 'Glass Rooms', artist: 'Another Demo', genre: 'House', bpm: 120, tonality: '6B', durationSec: 240 },
  { id: 'demo-6', name: 'Slow Burn', artist: 'Another Demo', genre: 'Disco', bpm: 108, tonality: '2B', durationSec: 215 }
] as const

/** A mono 8-bit PCM WAV: a quiet sine, a few seconds — small enough to ship in code. */
function toneWav(hz: number, seconds: number) {
  const rate = 8000, n = rate * seconds
  const buf = new Uint8Array(44 + n)
  const v = new DataView(buf.buffer)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true)
  str(36, 'data'); v.setUint32(40, n, true)
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(40 * Math.sin(2 * Math.PI * hz * i / rate))
  return buf
}

/** Seed the demo library into a team that has no tracks yet. Never throws. */
export async function seedDemoLibrary(audit: ImportAudit) {
  try {
    const db = useDB()
    const [anyTrack] = await db.select({ id: crateTracks.id }).from(crateTracks).where(eq(crateTracks.teamId, audit.teamId)).limit(1)
    if (anyTrack) return
    // An owner who cleared every track but kept/made piles has been here: don't bring the demo back.
    const [anyPile] = await db.select({ id: cratePiles.id }).from(cratePiles).where(eq(cratePiles.teamId, audit.teamId)).limit(1)
    if (anyPile) return

    await seedPiles(audit, PILES)
    const now = new Date()
    const rows = []
    for (const t of TRACKS) {
      let audioPath: string | null = null
      if ('hz' in t) {
        const key = `${audit.teamId}/demo/${t.id}.wav`
        await blob.put(key, new Blob([toneWav(t.hz, t.durationSec)], { type: 'audio/wav' }), { contentType: 'audio/wav' })
        audioPath = `${BLOB_PREFIX}${key}`
      }
      rows.push({
        ...audit, rekordboxId: `${UPLOAD_ID_PREFIX}${t.id}`, name: t.name, artist: t.artist, genre: t.genre,
        bpm: t.bpm, tonality: t.tonality, durationSec: t.durationSec, dateAdded: now, location: `demo/${t.id}`,
        audioPath, tags: [] as string[]
      })
    }
    await db.insert(crateTracks).values(rows).onConflictDoNothing()

    const ids = new Map<string, string>((await db.select({ id: crateTracks.id, rekordboxId: crateTracks.rekordboxId }).from(crateTracks)
      .where(eq(crateTracks.teamId, audit.teamId))).map((r: { id: string, rekordboxId: string }) => [r.rekordboxId, r.id] as [string, string]))
    const tips = TRACKS.flatMap(t => 'tip' in t && ids.has(`${UPLOAD_ID_PREFIX}${t.id}`)
      ? [{ trackId: ids.get(`${UPLOAD_ID_PREFIX}${t.id}`)!, result: { styles: t.tip.map(s => [...s]) } }] : [])
    await mergeLookupSource(audit, 'Audio', tips)
  }
  catch (err) {
    console.error('[crate/demo-seed] failed:', err)
  }
}
