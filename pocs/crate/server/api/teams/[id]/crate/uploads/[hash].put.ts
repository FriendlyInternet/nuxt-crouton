// Upload one track (#2237). The body is the raw file; the name and length come in the query.
// The track lands in the inbox (tag NEW) and plays from crate's own storage until it's exported.
import { z } from 'zod'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateTracks } from '~~/server/db/schema'
import { BLOB_PREFIX, UPLOAD_ID_PREFIX, assertUploadable, blobKey, parseFileName, storeUpload } from '~~/server/utils/crate-uploads'

const querySchema = z.object({
  fileName: z.string().min(1).max(500),
  durationSec: z.coerce.number().int().min(0).max(24 * 3600).optional()
})

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const hash = getRouterParam(event, 'hash') ?? ''
  if (!/^[0-9a-f]{64}$/.test(hash)) throw createError({ status: 400, statusText: 'Bad file hash' })
  const { fileName, durationSec } = await getValidatedQuery(event, querySchema.parse)

  const size = Number(getRequestHeader(event, 'content-length') ?? 0)
  const ext = assertUploadable(fileName, size)

  // 29 hex chars of SHA-256 keeps the id within the 32-char rekordboxId column.
  const rekordboxId = `${UPLOAD_ID_PREFIX}${hash.slice(0, 29)}`
  const key = blobKey(team.id, hash, ext)
  const contentType = getRequestHeader(event, 'content-type') || 'application/octet-stream'
  await storeUpload(event, key, contentType, size)

  const { artist, title } = parseFileName(fileName)
  const audit = { teamId: team.id, owner: user.id, createdBy: user.id, updatedBy: user.id }
  const [row] = await useDB().insert(crateTracks).values({
    ...audit,
    rekordboxId,
    name: title,
    artist,
    durationSec: durationSec || null,
    dateAdded: new Date(),
    location: `upload://${fileName}`,
    audioPath: `${BLOB_PREFIX}${key}`,
    originalComments: '',
    tags: ['NEW']
  }).onConflictDoNothing({ target: [crateTracks.teamId, crateTracks.rekordboxId] }).returning()
  if (!row) throw createError({ status: 409, statusText: 'Already in crate' })

  return { id: row.id, name: row.name, artist: row.artist, genre: null, year: null, bpm: null, tonality: null, durationSec: row.durationSec, hasAudio: true, tags: ['NEW'] }
})
