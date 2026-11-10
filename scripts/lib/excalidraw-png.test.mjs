// Round-trip tests for the Excalidraw PNG scene codec (#3692) — the part that stays once the
// draw.io spike (and its embedTextChunk helper) is removed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { embedScene, extractScene } from './excalidraw-png.mjs'

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([len, typeAndData, crc])
}

// A minimal valid 1×1 8-bit grayscale PNG.
function tinyPng() {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0) // width
  ihdr.writeUInt32BE(1, 4) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // color type: grayscale
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const scene = {
  type: 'excalidraw',
  version: 2,
  elements: [{ id: 'a', type: 'text', text: 'héllo ✓' }],
  appState: {},
}

test('embedScene → extractScene round-trips the scene', () => {
  assert.deepEqual(extractScene(embedScene(tinyPng(), scene)), scene)
})

test('extractScene throws a clear error on a PNG with no embedded scene', () => {
  assert.throws(() => extractScene(tinyPng()), /No embedded Excalidraw scene/)
})

test('embedScene keeps the PNG valid', () => {
  const out = embedScene(tinyPng(), scene)
  assert.deepEqual(out.subarray(0, 8), PNG_SIG)
  assert.equal(out.subarray(out.length - 8, out.length - 4).toString('latin1'), 'IEND')
})
