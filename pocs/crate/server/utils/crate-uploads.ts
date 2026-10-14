// Uploaded tracks (#2237): new music goes into crate first and into rekordbox last.
// A track uploaded here waits in crate's own storage (R2) until the Mac exports it into the
// library. Its id is `up_<content hash>`, so the same file can never be uploaded twice, and
// its audio path is `blob:<key>` (next to the Dropbox paths of tracks rekordbox already has).
import type { H3Event } from 'h3'
import { blob } from 'hub:blob'

export const UPLOAD_ID_PREFIX = 'up_'
export const BLOB_PREFIX = 'blob:'
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // a Worker request body tops out at 100 MB
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'aif', 'aiff', 'wav', 'flac', 'ogg', 'alac'] as const

/** "12345678_Artist - Title (Extended Mix).mp3" → { artist, title }. Keeps the mix name: a remix is its own track. */
export function parseFileName(fileName: string) {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/^\d{5,}_/, '') // store download id prefix
    .replace(/^\d{1,2}[AB] - \d{2,3}(?:\.\d+)? - /i, '') // "4A - 128 - " key/BPM prefix
    .replace(/ - \d{1,2}[AB] - \d{2,3}(?:\.\d+)?$/i, '') // " - 4A - 128" key/BPM suffix
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const dash = base.indexOf(' - ')
  if (dash > 0) return { artist: base.slice(0, dash).trim(), title: base.slice(dash + 3).trim() }
  return { artist: null, title: base || fileName }
}

/** Artist + title folded for duplicate matching: case, accents, "Original Mix" and punctuation don't count. */
export function matchKey(artist: string | null | undefined, title: string) {
  const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const t = fold(title).replace(/\((original|extended) mix\)/g, '')
  const a = fold(artist ?? '').split(/,|&| feat\.? | ft\.? | x /).map(s => s.replace(/[^a-z0-9]/g, '')).filter(Boolean).sort().join('+')
  return `${a}|${t.replace(/[^a-z0-9]/g, '')}`
}

/** Refuse what can't become a track: not audio, no length, or over the Worker's 100 MB body limit. Returns the extension. */
export function assertUploadable(fileName: string, size: number) {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (!(AUDIO_EXTENSIONS as readonly string[]).includes(ext)) throw createError({ status: 415, statusText: `Not an audio file: .${ext}` })
  if (!size) throw createError({ status: 411, statusText: 'Upload needs a Content-Length' })
  if (size > MAX_UPLOAD_BYTES) throw createError({ status: 413, statusText: 'Over 100 MB — convert to MP3/M4A/FLAC first' })
  return ext
}

export const blobKey = (teamId: string, hash: string, ext: string) => `crate/${teamId}/${hash}.${ext}`

interface R2Range { offset: number, length?: number }
interface R2Object { body: ReadableStream, size: number, httpEtag: string, httpMetadata?: { contentType?: string }, range?: R2Range }
interface R2Bucket {
  get: (key: string, opts?: { range?: R2Range }) => Promise<R2Object | null>
  head: (key: string) => Promise<{ size: number } | null>
  put: (key: string, body: ReadableStream | ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>
}
/** The raw R2 binding on Cloudflare (streams + ranges); undefined in local dev, where hub:blob's fs driver stands in. */
const r2 = (event: H3Event) => (event.context.cloudflare?.env as { BLOB?: R2Bucket } | undefined)?.BLOB

/** Store the request body (`size` bytes) as `key`. Streams straight into R2 on Cloudflare — a 100 MB
 *  file never sits in Worker memory. R2 only takes a stream of known length, hence FixedLengthStream. */
export async function storeUpload(event: H3Event, key: string, contentType: string, size: number) {
  const bucket = r2(event)
  if (bucket) {
    const stream = getRequestWebStream(event)
    if (!stream) throw createError({ status: 400, statusText: 'Empty upload' })
    const { readable, writable } = new (globalThis as unknown as { FixedLengthStream: new (n: number) => TransformStream })
      .FixedLengthStream(size)
    await Promise.all([stream.pipeTo(writable), bucket.put(key, readable, { httpMetadata: { contentType } })])
    return
  }
  const body = await readRawBody(event, false)
  if (!body?.length) throw createError({ status: 400, statusText: 'Empty upload' })
  await blob.put(key, new Blob([new Uint8Array(body)], { type: contentType }), { contentType })
}

/** Play `key` with Range support, so the deck can start at 30% and Safari can seek. */
export async function serveUpload(event: H3Event, key: string) {
  const bucket = r2(event)
  if (!bucket) return blob.serve(event, key) // local dev: whole file, no ranges
  const range = parseRange(getRequestHeader(event, 'range'))
  const obj = await bucket.get(key, range ? { range } : undefined)
  if (!obj) throw createError({ status: 404, statusText: 'Audio not found' })
  setResponseHeaders(event, {
    'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'ETag': obj.httpEtag,
    'Cache-Control': 'private, max-age=3600'
  })
  if (range) {
    const start = range.offset
    const end = Math.min(obj.size - 1, range.length === undefined ? obj.size - 1 : start + range.length - 1)
    setResponseStatus(event, 206)
    setResponseHeaders(event, { 'Content-Range': `bytes ${start}-${end}/${obj.size}`, 'Content-Length': String(end - start + 1) })
  }
  else {
    setResponseHeader(event, 'Content-Length', obj.size)
  }
  return obj.body
}

/** "bytes=100-" / "bytes=100-199" → an R2 range. Suffix ranges ("bytes=-500") are rare from <audio>; serve the whole file. */
function parseRange(header: string | undefined): R2Range | null {
  const m = header?.match(/^bytes=(\d+)-(\d*)$/)
  if (!m) return null
  const offset = Number(m[1])
  return m[2] ? { offset, length: Number(m[2]) - offset + 1 } : { offset }
}
