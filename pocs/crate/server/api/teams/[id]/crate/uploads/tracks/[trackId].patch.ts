// Rename an uploaded track (#2237): the export uses these as rekordbox's artist + title.
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { crateTracks } from '~~/server/db/schema'
import { requireUploadedTrack } from '~~/server/utils/crate-upload-track'

const bodySchema = z.object({
  artist: z.string().trim().max(500),
  name: z.string().trim().min(1).max(500)
})

export default defineEventHandler(async (event) => {
  const { track } = await requireUploadedTrack(event)
  const { artist, name } = await readValidatedBody(event, bodySchema.parse)
  await useDB().update(crateTracks).set({ artist: artist || null, name, updatedAt: new Date() }).where(eq(crateTracks.id, track.id))
  return { id: track.id, artist: artist || null, name }
})
