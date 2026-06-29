#!/usr/bin/env node
// Generates assets/prism-icon.png — a 512x512 spectrum gradient used as the
// MCP bundle (.mcpb) icon. Pure Node (zlib + a hand-rolled PNG encoder), so it
// needs no image libraries.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SIZE = 512

let CRC_TABLE
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

const stops = [
  [124, 92, 255], // #7c5cff purple
  [25, 195, 166], // #19c3a6 teal
  [240, 180, 41] // #f0b429 amber
]
function lerp(a, b, t) {
  return Math.round(a + (b - a) * t)
}
function spectrum(t) {
  const seg = t < 0.5 ? 0 : 1
  const lt = t < 0.5 ? t * 2 : (t - 0.5) * 2
  const a = stops[seg]
  const b = stops[seg + 1]
  return [lerp(a[0], b[0], lt), lerp(a[1], b[1], lt), lerp(a[2], b[2], lt)]
}

// Raw image: one filter byte (0) per scanline, then RGBA pixels.
const raw = Buffer.alloc((1 + SIZE * 4) * SIZE)
let p = 0
for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    const t = (x + y) / (2 * (SIZE - 1)) // diagonal sweep
    const [r, g, b] = spectrum(t)
    // subtle vignette toward a deep background at the corners
    const dx = (x - SIZE / 2) / (SIZE / 2)
    const dy = (y - SIZE / 2) / (SIZE / 2)
    const d = Math.min(1, Math.sqrt(dx * dx + dy * dy))
    const k = 1 - 0.35 * d * d
    raw[p++] = Math.round(r * k + 10 * (1 - k))
    raw[p++] = Math.round(g * k + 11 * (1 - k))
    raw[p++] = Math.round(b * k + 16 * (1 - k))
    raw[p++] = 255
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const assets = fileURLToPath(new URL('../assets', import.meta.url))
mkdirSync(assets, { recursive: true })
const out = fileURLToPath(new URL('../assets/prism-icon.png', import.meta.url))
writeFileSync(out, png)
console.log(`wrote ${out} (${png.length} bytes)`)
