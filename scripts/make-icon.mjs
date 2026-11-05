// Generates resources/icon.png (256px) and resources/icon.ico (16-256px) with
// no dependencies: shapes are rasterized from signed distance functions with
// 4x4 supersampling, then PNG-encoded with zlib. Run: npm run icon
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources')

// ---- shapes (unit square, y down) -----------------------------------------
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r
  const qy = Math.abs(y - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const sdSegment = (x, y, ax, ay, bx, by, r) => {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay
  const h = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - dx * h, py - dy * h) - r
}
const mix = (a, b, t) => a + (b - a) * t
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

const BG_A = hex('#8a7cff')
const BG_B = hex('#5546d6')
const WHITE = [255, 255, 255]
const ACCENT = hex('#ff6b5e')

/** Color + coverage of each layer at a point; painter's order. */
function layers(x, y, variant = 'app') {
  if (variant === 'template') return templateLayers(x, y)
  const out = []
  // background tile
  const bg = sdRoundRect(x, y, 0.5, 0.5, 0.46, 0.46, 0.2)
  const t = Math.min(1, Math.max(0, (x + y) / 2))
  out.push([bg <= 0, [mix(BG_A[0], BG_B[0], t), mix(BG_A[1], BG_B[1], t), mix(BG_A[2], BG_B[2], t)]])
  // crop-corner brackets
  const lo = 0.22, hi = 0.78, arm = 0.17, w = 0.035
  let bracket = Infinity
  for (const [cx, sx] of [[lo, 1], [hi, -1]]) {
    for (const [cy, sy] of [[lo, 1], [hi, -1]]) {
      bracket = Math.min(
        bracket,
        sdSegment(x, y, cx, cy, cx + sx * arm, cy, w),
        sdSegment(x, y, cx, cy, cx, cy + sy * arm, w)
      )
    }
  }
  out.push([bracket <= 0 && bg <= 0, WHITE])
  // annotation arrow
  const ax = 0.36, ay = 0.64, bx = 0.63, by = 0.37, sw = 0.045
  const shaft = sdSegment(x, y, ax, ay, bx, by, sw)
  const head1 = sdSegment(x, y, bx, by, bx - 0.15, by, sw)
  const head2 = sdSegment(x, y, bx, by, bx, by + 0.15, sw)
  out.push([Math.min(shaft, head1, head2) <= 0, ACCENT])
  return out
}

/** Monochrome menu-bar glyph for macOS ("Template" images are tinted by the system). */
function templateLayers(x, y) {
  const lo = 0.1, hi = 0.9, arm = 0.26, w = 0.06
  let d = Infinity
  for (const [cx, sx] of [[lo, 1], [hi, -1]]) {
    for (const [cy, sy] of [[lo, 1], [hi, -1]]) {
      d = Math.min(d, sdSegment(x, y, cx, cy, cx + sx * arm, cy, w), sdSegment(x, y, cx, cy, cx, cy + sy * arm, w))
    }
  }
  const ax = 0.3, ay = 0.7, bx = 0.68, by = 0.32, sw = 0.07
  d = Math.min(d, sdSegment(x, y, ax, ay, bx, by, sw), sdSegment(x, y, bx, by, bx - 0.22, by, sw), sdSegment(x, y, bx, by, bx, by + 0.22, sw))
  return [[d <= 0, [0, 0, 0]]]
}

/**
 * Rasterize at `size` px. `scale` < 1 shrinks the artwork around the centre
 * (macOS app icons sit inside ~80% of the canvas, per Apple's icon grid).
 */
function render(size, { variant = 'app', scale = 1 } = {}) {
  const ss = size > 256 ? 3 : variant === 'template' ? 8 : 4
  const px = Buffer.alloc(size * size * 4)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const x = ((i + (si + 0.5) / ss) / size - 0.5) / scale + 0.5
          const y = ((j + (sj + 0.5) / ss) / size - 0.5) / scale + 0.5
          let cr = 0, cg = 0, cb = 0, ca = 0
          for (const [inside, col] of layers(x, y, variant)) {
            if (!inside) continue
            cr = col[0]; cg = col[1]; cb = col[2]; ca = 1
          }
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca
        }
      }
      const n = ss * ss
      const o = (j * size + i) * 4
      px[o] = a ? Math.round(r / a) : 0
      px[o + 1] = a ? Math.round(g / a) : 0
      px[o + 2] = a ? Math.round(b / a) : 0
      px[o + 3] = Math.round((a / n) * 255)
    }
  }
  return encodePng(size, size, px)
}

// ---- PNG / ICO encoding -----------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = 6 + dir.length
  images.forEach(({ size, png }, i) => {
    const o = i * 16
    dir[o] = size >= 256 ? 0 : size
    dir[o + 1] = size >= 256 ? 0 : size
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...images.map((i) => i.png)])
}

mkdirSync(outDir, { recursive: true })
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const images = sizes.map((size) => ({ size, png: render(size) }))
writeFileSync(join(outDir, 'icon.png'), images.at(-1).png)
writeFileSync(join(outDir, 'icon.ico'), encodeIco(images))
// macOS: app icon on Apple's grid (electron-builder turns it into .icns) and menu-bar template images.
writeFileSync(join(outDir, 'icon-mac.png'), render(1024, { scale: 0.86 }))
writeFileSync(join(outDir, 'trayTemplate.png'), render(16, { variant: 'template' }))
writeFileSync(join(outDir, 'trayTemplate@2x.png'), render(32, { variant: 'template' }))
console.log('[icon] wrote resources/icon.png, icon.ico (' + sizes.join(', ') + ' px), icon-mac.png, trayTemplate.png, trayTemplate@2x.png')
