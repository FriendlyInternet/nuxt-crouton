/**
 * Excalidraw PNG scene metadata — extract (and embed) the editable scene stored inside a
 * PNG that Excalidraw exported with "Embed scene" on. Dependency-free (Node zlib + manual
 * PNG chunk parsing); mirrors Excalidraw's own format so it round-trips real exports.
 *
 * Format (from Excalidraw's data/image.ts + data/encode.ts):
 *   a `tEXt` chunk with keyword "application/vnd.excalidraw+json" whose text is JSON
 *   { version, encoding:"bstring", compressed, encoded } where `encoded` is a latin1
 *   byte-string of the (pako/zlib-)deflated scene JSON.
 */
import zlib from 'node:zlib'

export const EXCALIDRAW_MIME = 'application/vnd.excalidraw+json'
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function isPng(buf) {
  return buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIG)
}

// ── PNG chunk parsing ────────────────────────────────────────────────────────
function parseChunks(buf) {
  if (!isPng(buf)) throw new Error('Not a PNG (bad signature)')
  const chunks = []
  let o = 8
  while (o + 12 <= buf.length) {
    const len = buf.readUInt32BE(o)
    const type = buf.toString('latin1', o + 4, o + 8)
    const data = buf.subarray(o + 8, o + 8 + len)
    chunks.push({ type, data })
    o += 12 + len
    if (type === 'IEND') break
  }
  return chunks
}

// ── CRC32 (for re-encoding) ──────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function makeChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// ── tEXt encode/decode ───────────────────────────────────────────────────────
function decodeTextChunk(data) {
  const zero = data.indexOf(0)
  if (zero === -1) return null
  return { keyword: data.toString('latin1', 0, zero), text: data.toString('latin1', zero + 1) }
}

/**
 * Extract the Excalidraw scene from a scene-embedded PNG. Throws a clear error if the PNG
 * wasn't exported with "Embed scene" (no excalidraw tEXt chunk).
 */
export function extractScene(pngBuffer) {
  const buf = Buffer.isBuffer(pngBuffer) ? pngBuffer : Buffer.from(pngBuffer)
  const chunks = parseChunks(buf)
  let payloadText = null
  for (const c of chunks) {
    if (c.type !== 'tEXt') continue
    const t = decodeTextChunk(c.data)
    if (t && t.keyword === EXCALIDRAW_MIME) {
      payloadText = t.text
      break
    }
  }
  if (payloadText == null) {
    throw new Error(
      'No embedded Excalidraw scene in this PNG. In Excalidraw, export the image with ' +
        '"Embed scene" turned ON, then attach that PNG.',
    )
  }
  let meta
  try {
    meta = JSON.parse(payloadText)
  } catch {
    throw new Error('Embedded metadata is not valid JSON.')
  }
  // Current format: { encoding:"bstring", compressed, encoded }. Legacy: the text IS the scene.
  let sceneJson
  if (meta && typeof meta === 'object' && 'encoded' in meta) {
    const bytes = Buffer.from(meta.encoded, 'latin1')
    sceneJson = meta.compressed ? inflate(bytes).toString('utf8') : bytes.toString('utf8')
  } else {
    sceneJson = payloadText
  }
  const scene = JSON.parse(sceneJson)
  return scene
}

function inflate(bytes) {
  // Excalidraw uses pako.deflate (zlib format). Fall back to raw deflate just in case.
  try {
    return zlib.inflateSync(bytes)
  } catch {
    return zlib.inflateRawSync(bytes)
  }
}

/**
 * Embed a scene into a PNG buffer (inverse of extractScene) — used to self-test the codec
 * without a real Excalidraw export, and available for embedding scenes into our own renders.
 */
export function embedScene(pngBuffer, scene) {
  const buf = Buffer.isBuffer(pngBuffer) ? pngBuffer : Buffer.from(pngBuffer)
  const chunks = parseChunks(buf)
  const deflated = zlib.deflateSync(Buffer.from(JSON.stringify(scene), 'utf8'))
  const payload = JSON.stringify({
    version: '1',
    encoding: 'bstring',
    compressed: true,
    encoded: deflated.toString('latin1'),
  })
  const data = Buffer.concat([
    Buffer.from(EXCALIDRAW_MIME, 'latin1'),
    Buffer.from([0]),
    Buffer.from(payload, 'latin1'),
  ])
  const textChunk = makeChunk('tEXt', data)
  // Rebuild: signature + all chunks, inserting tEXt just before IEND.
  const out = [PNG_SIG]
  for (const c of chunks) {
    if (c.type === 'IEND') out.push(textChunk)
    out.push(makeChunk(c.type, c.data))
  }
  return Buffer.concat(out)
}
