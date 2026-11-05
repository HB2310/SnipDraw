import { describe, expect, it } from 'vitest'
import {
  EDITOR_CHROME,
  EDITOR_MIN,
  EDITOR_PADDING,
  fitImage,
  dragToRect,
  editorBounds,
  groupByNativeSize,
  matchSources,
  nativeSize,
  physicalLength,
  resolveExportScale,
  sceneImageSize,
  viewportRectToPixels,
  type DisplayLike
} from './geometry'

/**
 * Display layouts as Electron reports them on Windows (DIP bounds; x/y of
 * secondary monitors are in Electron's mixed-DPI screen coordinate space).
 */
const laptop150: DisplayLike = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1707, height: 1067 }, // 2560x1600 @ 150%
  workArea: { x: 0, y: 0, width: 1707, height: 1019 },
  scaleFactor: 1.5
}
const monitor100Left: DisplayLike = {
  id: 2,
  bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
  workArea: { x: -1920, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1
}
const uhd150Right: DisplayLike = {
  id: 3,
  bounds: { x: 1707, y: -200, width: 2560, height: 1440 }, // 3840x2160 @ 150%
  workArea: { x: 1707, y: -200, width: 2560, height: 1392 },
  scaleFactor: 1.5
}
const uhd200: DisplayLike = {
  id: 4,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 }, // 3840x2160 @ 200%
  workArea: { x: 0, y: 0, width: 1920, height: 1032 },
  scaleFactor: 2
}
const fhd125: DisplayLike = {
  id: 5,
  bounds: { x: 0, y: 0, width: 1536, height: 864 }, // 1920x1080 @ 125%
  workArea: { x: 0, y: 0, width: 1536, height: 816 },
  scaleFactor: 1.25
}
const fhd175: DisplayLike = {
  id: 6,
  // 1920x1080 @ 175% = 1097.14 x 617.14 DIP; Electron rounds to integers.
  bounds: { x: 0, y: 0, width: 1097, height: 617 },
  workArea: { x: 0, y: 0, width: 1097, height: 569 },
  scaleFactor: 1.75
}

describe('nativeSize', () => {
  it.each([
    [laptop150, 2561, 1601], // 1707*1.5 = 2560.5 -> rounds up; see bitmap-based mapping below
    [monitor100Left, 1920, 1080],
    [uhd150Right, 3840, 2160],
    [uhd200, 3840, 2160],
    [fhd125, 1920, 1080],
    [fhd175, 1920, 1080] // 1097*1.75 = 1919.75 -> 1920
  ])('display %#', (d, w, h) => {
    expect(nativeSize(d)).toEqual({ width: w, height: h })
  })
})

describe('nativeSize with physical origin (exact)', () => {
  // Real layout measured on a dev machine: 5120x2160@125% primary, 2560x1440@100%
  // above it, and a portrait 1440x2560@125% to the left at physical y=-762.
  const ultrawide = { bounds: { x: 0, y: 0, width: 4096, height: 1728 }, scaleFactor: 1.25, physicalOrigin: { x: 0, y: 0 } }
  const above = { bounds: { x: 284, y: -1440, width: 2560, height: 1440 }, scaleFactor: 1, physicalOrigin: { x: 356, y: -1440 } }
  const portrait = { bounds: { x: -1152, y: -610, width: 1152, height: 2049 }, scaleFactor: 1.25, physicalOrigin: { x: -1440, y: -762 } }

  it('recovers 1440x2560 for the portrait monitor reported as 2049 DIP tall', () => {
    expect(nativeSize(portrait)).toEqual({ width: 1440, height: 2560 })
    // naive DIP*scale would be wrong:
    expect(nativeSize({ ...portrait, physicalOrigin: undefined })).toEqual({ width: 1440, height: 2561 })
  })

  it('leaves exact cases alone', () => {
    expect(nativeSize(ultrawide)).toEqual({ width: 5120, height: 2160 })
    expect(nativeSize(above)).toEqual({ width: 2560, height: 1440 })
  })

  it('fixes 2560x1600 @150% (1707x1067 DIP)', () => {
    expect(nativeSize({ ...laptop150, physicalOrigin: { x: 0, y: 0 } })).toEqual({ width: 2560, height: 1600 })
  })

  it.each([
    // [physical length, physical start, scale]
    [3840, 0, 1.5],
    [2160, 0, 1.5],
    [1920, 0, 1.75],
    [1080, 0, 1.75],
    [1366, 0, 1.25],
    [768, 0, 1.25],
    [1366, 0, 1.5],
    [2256, 0, 1.5],
    [1504, 0, 1.5],
    [2736, 0, 2],
    [1824, 0, 2],
    [2880, 0, 1.75],
    [1920, 2560, 1.25],
    [1080, -1080, 1.5],
    [2560, -762, 1.25],
    [1600, 1440, 1.75],
    [3840, -3840, 2.25]
  ])('round-trips %i px starting at %i @ %f', (len, start, s) => {
    // Chromium's enclosing conversion to DIP:
    const dip = Math.ceil((start + len) / s - 1e-9) - Math.floor(start / s + 1e-9)
    expect(physicalLength(start, dip, s)).toBe(len)
  })
})

describe('groupByNativeSize', () => {
  it('splits mixed-DPI setups into one capture call per native size', () => {
    const groups = groupByNativeSize([laptop150, monitor100Left, uhd150Right])
    expect(groups.map((g) => [g.size.width, g.size.height, g.displays.map((d) => d.id)])).toEqual([
      [2561, 1601, [1]],
      [1920, 1080, [2]],
      [3840, 2160, [3]]
    ])
  })

  it('groups identical monitors even at different DPI', () => {
    const a = { ...uhd200, id: 10 }
    const b = { ...uhd150Right, id: 11 }
    const groups = groupByNativeSize([a, b])
    expect(groups).toHaveLength(1)
    expect(groups[0].displays.map((d) => d.id)).toEqual([10, 11])
  })
})

describe('dragToRect', () => {
  const vp = { width: 1920, height: 1080 }
  it('normalizes drags in any direction', () => {
    expect(dragToRect(300, 200, 100, 50, vp)).toEqual({ x: 100, y: 50, width: 200, height: 150 })
    expect(dragToRect(100, 200, 300, 50, vp)).toEqual({ x: 100, y: 50, width: 200, height: 150 })
  })
  it('clamps to the viewport', () => {
    expect(dragToRect(-20, -5, 2000, 1200, vp)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })
})

describe('viewportRectToPixels', () => {
  it('is identity at 100%', () => {
    expect(viewportRectToPixels({ x: 10, y: 20, width: 300, height: 200 }, { width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200
    })
  })

  it('scales by 1.5 at 150%', () => {
    expect(
      viewportRectToPixels({ x: 100, y: 100, width: 200, height: 100 }, { width: 2560, height: 1440 }, { width: 3840, height: 2160 })
    ).toEqual({ x: 150, y: 150, width: 300, height: 150 })
  })

  it('scales by 2 at 200%', () => {
    expect(
      viewportRectToPixels({ x: 0.5, y: 10, width: 100, height: 50.25 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 })
    ).toEqual({ x: 1, y: 20, width: 200, height: 101 })
  })

  it('maps the full viewport to the full bitmap even when DIP size is rounded (175%)', () => {
    const vp = { width: 1097, height: 617 }
    const bmp = { width: 1920, height: 1080 }
    expect(viewportRectToPixels({ x: 0, y: 0, width: 1097, height: 617 }, vp, bmp)).toEqual({ x: 0, y: 0, ...bmp })
  })

  it('uses the actual bitmap size, not DIP*scale, when they disagree (1707 DIP @150% = 2560 px)', () => {
    // Electron rounds 2560/1.5 = 1706.67 to 1707; the capture is really 2560 wide.
    const r = viewportRectToPixels({ x: 1700, y: 0, width: 7, height: 10 }, { width: 1707, height: 1067 }, { width: 2560, height: 1600 })
    expect(r.x + r.width).toBe(2560) // right edge of screen -> right edge of bitmap
    expect(r.x).toBe(Math.round(1700 * (2560 / 1707)))
  })

  it('never exceeds the bitmap', () => {
    const r = viewportRectToPixels({ x: 1900, y: 1070, width: 100, height: 100 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 })
    expect(r.x + r.width).toBeLessThanOrEqual(3840)
    expect(r.y + r.height).toBeLessThanOrEqual(2160)
  })

  it('selections that share an edge tile without gaps at fractional scale (125%)', () => {
    const vp = { width: 1536, height: 864 }
    const bmp = { width: 1920, height: 1080 }
    const a = viewportRectToPixels({ x: 0, y: 0, width: 333, height: 10 }, vp, bmp)
    const b = viewportRectToPixels({ x: 333, y: 0, width: 333, height: 10 }, vp, bmp)
    expect(a.x + a.width).toBe(b.x)
  })
})

describe('editorBounds', () => {
  it('fits a small snip with padding, at least the minimum size, centered on the work area', () => {
    const b = editorBounds({ width: 300, height: 200 }, monitor100Left)
    expect(b.width).toBe(EDITOR_MIN.width)
    expect(b.height).toBe(EDITOR_MIN.height)
    expect(b.x).toBe(-1920 + Math.round((1920 - b.width) / 2))
    expect(b.y).toBe(Math.round((1040 - b.height) / 2))
  })

  it('sizes in DIPs on a high-DPI display (image shown at 1:1 physical px)', () => {
    // 1800x1200 px snip on a 150% display is 1200x800 DIP.
    const b = editorBounds({ width: 1800, height: 1200 }, uhd150Right)
    expect(b.width).toBe(1200 + EDITOR_PADDING.width)
    expect(b.height).toBe(800 + EDITOR_PADDING.height)
    // centered inside that display's work area
    expect(b.x).toBe(1707 + Math.round((2560 - b.width) / 2))
    expect(b.y).toBe(-200 + Math.round((1392 - b.height) / 2))
  })

  it('caps at 85% of the display for huge snips', () => {
    const b = editorBounds({ width: 3840, height: 2160 }, uhd200)
    expect(b.width).toBe(Math.floor(1920 * 0.85))
    expect(b.height).toBe(Math.floor(1080 * 0.85))
  })

  it('stays inside the work area on short screens', () => {
    const b = editorBounds({ width: 1920, height: 1080 }, fhd175)
    expect(b.height).toBeLessThanOrEqual(569)
    expect(b.width).toBeLessThanOrEqual(Math.floor(1097 * 0.85))
    expect(b.y).toBeGreaterThanOrEqual(0)
  })
})

describe('scene/export scale', () => {
  it('scene image size is in DIPs of the source display', () => {
    expect(sceneImageSize({ width: 300, height: 150 }, 1.5)).toEqual({ width: 200, height: 100 })
  })
  it('native export scale reproduces the captured pixel size', () => {
    const img = sceneImageSize({ width: 333, height: 777 }, 1.75)
    const s = resolveExportScale('native', 1.75)
    expect(Math.round(img.width * s)).toBe(333)
    expect(Math.round(img.height * s)).toBe(777)
  })
  it('numeric export scale is used as-is', () => {
    expect(resolveExportScale(2, 1.5)).toBe(2)
  })
})

describe('matchSources', () => {
  it('matches by display_id', () => {
    const m = matchSources([{ display_id: '3' }, { display_id: '1' }], [1, 3], [1, 2, 3])
    expect(m.get(1)?.display_id).toBe('1')
    expect(m.get(3)?.display_id).toBe('3')
  })
  it('falls back to enumeration order when ids are missing', () => {
    const s = [{ display_id: '', n: 'a' }, { display_id: '', n: 'b' }]
    const m = matchSources(s, [20], [10, 20])
    expect(m.get(20)?.n).toBe('b')
  })
  it('does not guess by order when some ids are present', () => {
    const m = matchSources([{ display_id: '99' }], [1], [1])
    expect(m.size).toBe(0)
  })
})

describe('fitImage', () => {
  const vp = { width: 1200, height: 800 }
  it('keeps small images at 100% and centers them in the area not covered by UI', () => {
    const f = fitImage({ width: 400, height: 200 }, vp)
    expect(f.zoom).toBe(1)
    // image is centered on scene origin; viewport x of its left edge:
    const left = (-200 + f.scrollX) * f.zoom
    const right = (200 + f.scrollX) * f.zoom
    expect(left).toBeGreaterThanOrEqual(EDITOR_CHROME.left)
    expect(right).toBeLessThanOrEqual(vp.width - EDITOR_CHROME.right)
    expect(left - EDITOR_CHROME.left).toBeCloseTo(vp.width - EDITOR_CHROME.right - right)
  })
  it('zooms out large images so they fit entirely', () => {
    const img = { width: 3000, height: 2000 }
    const f = fitImage(img, vp)
    expect(f.zoom).toBeLessThan(1)
    const top = (-img.height / 2 + f.scrollY) * f.zoom
    const bottom = (img.height / 2 + f.scrollY) * f.zoom
    expect(top).toBeGreaterThanOrEqual(EDITOR_CHROME.top - 1e-9)
    expect(bottom).toBeLessThanOrEqual(vp.height - EDITOR_CHROME.bottom + 1e-9)
  })
  it('a window sized by editorBounds shows the image at 100% without overlap', () => {
    const snip = { width: 900, height: 500 }
    const b = editorBounds(snip, monitor100Left)
    const content = { width: b.width - 16, height: b.height - 40 }
    expect(fitImage(snip, content).zoom).toBe(1)
  })
})
