// Before uploading (#2237): which of these files does crate already have?
// Same content hash = the very same file; same artist + title = most likely the same track.
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateTracks } from '~~/server/db/schema'
import { UPLOAD_ID_PREFIX, matchKey, parseFileName } from '~~/server/utils/crate-uploads'

const bodySchema = z.object({
  files: z.array(z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/), fileName: z.string().min(1).max(500) })).min(1).max(200)
})

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const { files } = await readValidatedBody(event, bodySchema.parse)
  type Row = { rekordboxId: string, name: string, artist: string | null }
  const rows: Row[] = await useDB().select({ rekordboxId: crateTracks.rekordboxId, name: crateTracks.name, artist: crateTracks.artist })
    .from(crateTracks).where(eq(crateTracks.teamId, team.id))
  const byId = new Map(rows.map(r => [r.rekordboxId, r]))
  const byKey = new Map(rows.map(r => [matchKey(r.artist, r.name), r]))
  const label = (r: Row) => (r.artist ? `${r.artist} - ${r.name}` : r.name)

  return files.map((f) => {
    const sameFile = byId.get(`${UPLOAD_ID_PREFIX}${f.hash.slice(0, 29)}`)
    if (sameFile) return { hash: f.hash, status: 'same-file' as const, match: label(sameFile) }
    const { artist, title } = parseFileName(f.fileName)
    const sameTrack = byKey.get(matchKey(artist, title))
    if (sameTrack) return { hash: f.hash, status: 'same-track' as const, match: label(sameTrack) }
    return { hash: f.hash, status: 'new' as const, match: null }
  })
})
