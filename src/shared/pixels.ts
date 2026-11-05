/**
 * Convert a BGRA bitmap (nativeImage.toBitmap() on Windows) into RGBA for
 * ImageData. Handles row padding: the source stride is derived from the
 * buffer length. Alpha is forced opaque (screen captures have no meaningful
 * alpha, and some drivers report 0).
 */
export function bgraToRgba(src: Uint8Array, width: number, height: number, dst: Uint8ClampedArray): void {
  if (dst.length < width * height * 4) throw new Error('destination too small')
  const stride = Math.floor(src.length / height)
  if (stride < width * 4) throw new Error(`bitmap too small: ${src.length} bytes for ${width}x${height}`)

  const aligned = stride === width * 4 && src.byteOffset % 4 === 0 && dst.byteOffset % 4 === 0
  if (aligned) {
    // Fast path: one 32-bit op per pixel. Little-endian: BGRA bytes read as 0xAARRGGBB.
    const s = new Uint32Array(src.buffer, src.byteOffset, width * height)
    const d = new Uint32Array(dst.buffer, dst.byteOffset, width * height)
    for (let i = 0; i < s.length; i++) {
      const v = s[i]
      // want bytes RGBA -> 0xAABBGGRR
      d[i] = 0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | ((v >>> 16) & 0xff)
    }
    return
  }

  for (let y = 0; y < height; y++) {
    let si = y * stride
    let di = y * width * 4
    for (let x = 0; x < width; x++, si += 4, di += 4) {
      dst[di] = src[si + 2]
      dst[di + 1] = src[si + 1]
      dst[di + 2] = src[si]
      dst[di + 3] = 255
    }
  }
}
