/**
 * Pure coordinate math for capture, cropping and window placement.
 *
 * Coordinate spaces involved (Windows, per-monitor DPI aware):
 *  - Screen DIPs: what Electron's `screen` module reports (`display.bounds`).
 *  - Native pixels: physical pixels of a display. NOT simply DIP size *
 *    scaleFactor: Chromium derives DIP bounds with an *enclosing* rect
 *    (floor the start edge, ceil the end edge), so a 1440x2560 portrait
 *    monitor at 125% placed at physical y=-762 is reported as 2049 DIP tall
 *    (2049 * 1.25 = 2561.25), and 2560x1600 at 150% is 1707x1067 DIP
 *    (-> 2561x1601). Asking desktopCapturer for a size that's 1px too big
 *    resamples the whole capture, so `nativeSize` inverts the rounding.
 *  - Overlay viewport CSS px: the overlay window covers one display, so its
 *    viewport is (nominally) the display's DIP size. We never rely on that:
 *    the selection is mapped with the *actual* viewport size and the *actual*
 *    bitmap size, so rounding in Electron's DIP sizes, or a window sized
 *    slightly wrong after a DPI change, can't skew the crop.
 */
import type { Rect, Size } from './types'

export interface DisplayLike {
  id: number
  bounds: Rect
  workArea: Rect
  scaleFactor: number
  /**
   * Physical-pixel position of the display's top-left corner
   * (screen.dipToScreenPoint(bounds origin) on Windows). Enables exact sizes.
   */
  physicalOrigin?: { x: number; y: number }
}

/** Physical pixel size of a display. */
export function nativeSize(d: Pick<DisplayLike, 'bounds' | 'scaleFactor' | 'physicalOrigin'>): Size {
  const s = d.scaleFactor
  const est = { width: Math.round(d.bounds.width * s), height: Math.round(d.bounds.height * s) }
  if (!d.physicalOrigin || s === 1) return est
  return {
    width: physicalLength(d.physicalOrigin.x, d.bounds.width, s) ?? est.width,
    height: physicalLength(d.physicalOrigin.y, d.bounds.height, s) ?? est.height
  }
}

/**
 * Invert Chromium's enclosing-rect DIP conversion along one axis.
 *
 * Given physical start `p0`, DIP length `dip` and scale `s`, the physical
 * length P satisfies ceil((p0 + P) / s) - floor(p0 / s) = dip, i.e. P lies in
 * the half-open interval (lo, hi] of width s. For s < 2 that's at most two
 * consecutive integers; panel resolutions are even (1366, 1080, 1440, 2560,
 * ...), so prefer the candidate with the most factors of two, then the larger.
 * Returns null if the inputs are inconsistent (caller falls back to rounding).
 */
export function physicalLength(p0: number, dip: number, s: number): number | null {
  const EPS = 1e-6
  const f = Math.floor(p0 / s + EPS)
  const lo = (dip + f - 1) * s - p0
  const hi = (dip + f) * s - p0
  let best: number | null = null
  for (let p = Math.floor(lo + EPS) + 1; p <= Math.floor(hi + EPS); p++) {
    if (p <= 0) continue
    if (best === null || twos(p) > twos(best) || (twos(p) === twos(best) && p > best)) best = p
  }
  // Sanity: never stray further than one scale step from the naive estimate.
  if (best === null || Math.abs(best - dip * s) > Math.ceil(s) + 1) return null
  return best
}

function twos(n: number): number {
  let c = 0
  while (n > 0 && n % 2 === 0 && c < 16) {
    n /= 2
    c++
  }
  return c
}

/**
 * desktopCapturer applies one thumbnailSize to every screen and scales each
 * capture to fit inside it, preserving aspect ratio (it upscales, too). To get
 * every display at exactly its native resolution we issue one getSources()
 * call per distinct native size (concurrently: each call costs ~350ms).
 */
export function groupByNativeSize<T extends Pick<DisplayLike, 'bounds' | 'scaleFactor' | 'physicalOrigin'>>(
  displays: readonly T[]
): Array<{ size: Size; displays: T[] }> {
  const groups = new Map<string, { size: Size; displays: T[] }>()
  for (const d of displays) {
    const size = nativeSize(d)
    const key = `${size.width}x${size.height}`
    const g = groups.get(key)
    if (g) g.displays.push(d)
    else groups.set(key, { size, displays: [d] })
  }
  return [...groups.values()]
}

/** Normalize a drag from (x0,y0) to (x1,y1) into a positive rect clamped to the viewport. */
export function dragToRect(x0: number, y0: number, x1: number, y1: number, viewport: Size): Rect {
  const left = clamp(Math.min(x0, x1), 0, viewport.width)
  const top = clamp(Math.min(y0, y1), 0, viewport.height)
  const right = clamp(Math.max(x0, x1), 0, viewport.width)
  const bottom = clamp(Math.max(y0, y1), 0, viewport.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Map a rect in overlay viewport CSS px to an integer rect in bitmap pixels.
 * Edges are rounded independently (rather than x and width) so the
 * right/bottom edge lands on the pixel under the cursor at any scale.
 */
export function viewportRectToPixels(rect: Rect, viewport: Size, bitmap: Size): Rect {
  const sx = bitmap.width / viewport.width
  const sy = bitmap.height / viewport.height
  const left = clamp(Math.round(rect.x * sx), 0, bitmap.width)
  const top = clamp(Math.round(rect.y * sy), 0, bitmap.height)
  const right = clamp(Math.round((rect.x + rect.width) * sx), 0, bitmap.width)
  const bottom = clamp(Math.round((rect.y + rect.height) * sy), 0, bitmap.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Below this many physical pixels in either direction a drag counts as a click. */
export const MIN_SELECTION_PX = 4

/** Smallest editor window that fits Excalidraw's toolbar plus Copy/Save. */
export const EDITOR_MIN: Size = { width: 960, height: 560 }
/**
 * Parts of the editor canvas covered by Excalidraw's UI (CSS px): the
 * properties panel on the left (open because a drawing tool is active), the
 * toolbar + hint line on top, zoom/undo bar at the bottom. The image is
 * centered in what's left.
 */
export const EDITOR_CHROME = { left: 232, right: 24, top: 96, bottom: 64 }
/** Windows title bar + borders around the content area (DIP, approximate). */
export const WINDOW_FRAME: Size = { width: 16, height: 40 }
/** Room around the image for Excalidraw's UI and the window frame. */
export const EDITOR_PADDING: Size = {
  width: EDITOR_CHROME.left + EDITOR_CHROME.right + WINDOW_FRAME.width,
  height: EDITOR_CHROME.top + EDITOR_CHROME.bottom + WINDOW_FRAME.height
}
export const EDITOR_MAX_FRACTION = 0.85

/**
 * Zoom and scroll that center an image (centered on scene origin) inside the
 * free part of the editor viewport. Zoom-to-fit, but never above 100% so
 * small snips stay pixel-crisp. Excalidraw maps scene -> viewport as
 * (scene + scroll) * zoom.
 *
 * At 100% the image's top-left corner is snapped to a whole device pixel
 * (`dpr` = devicePixelRatio), so each snip pixel lands on exactly one screen
 * pixel instead of being blurred across two.
 */
export function fitImage(img: Size, viewport: Size, dpr = 1): { zoom: number; scrollX: number; scrollY: number } {
  const c = EDITOR_CHROME
  const availW = Math.max(100, viewport.width - c.left - c.right)
  const availH = Math.max(100, viewport.height - c.top - c.bottom)
  const zoom = Math.max(0.1, Math.min(1, availW / img.width, availH / img.height))
  const cx = c.left + availW / 2
  const cy = c.top + availH / 2
  if (zoom !== 1) return { zoom, scrollX: cx / zoom, scrollY: cy / zoom }
  const left = Math.round((cx - img.width / 2) * dpr) / dpr
  const top = Math.round((cy - img.height / 2) * dpr) / dpr
  return { zoom, scrollX: left + img.width / 2, scrollY: top + img.height / 2 }
}

/**
 * Editor window bounds (screen DIPs) for a snip: the image at 1:1 physical
 * pixels plus padding, at least EDITOR_MIN, at most 85% of the display (and
 * never larger than its work area), centered on the display's work area.
 */
export function editorBounds(
  snipPx: Size,
  display: Pick<DisplayLike, 'bounds' | 'workArea' | 'scaleFactor'>
): Rect {
  const area = display.workArea
  const maxW = Math.min(area.width, Math.floor(display.bounds.width * EDITOR_MAX_FRACTION))
  const maxH = Math.min(area.height, Math.floor(display.bounds.height * EDITOR_MAX_FRACTION))
  const img = sceneImageSize(snipPx, display.scaleFactor)
  const width = Math.min(maxW, Math.max(EDITOR_MIN.width, Math.ceil(img.width + EDITOR_PADDING.width)))
  const height = Math.min(maxH, Math.max(EDITOR_MIN.height, Math.ceil(img.height + EDITOR_PADDING.height)))
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height
  }
}

/**
 * Size of the image element on the Excalidraw canvas. Scene units are CSS px
 * at zoom 1, so dividing by the source display's scale factor shows the snip
 * at 1:1 physical pixels when the editor is on that display.
 */
export function sceneImageSize(snipPx: Size, scaleFactor: number): Size {
  return { width: snipPx.width / scaleFactor, height: snipPx.height / scaleFactor }
}

/** Scale factor to hand to Excalidraw's export (scene units -> output px). */
export function resolveExportScale(setting: 'native' | number, scaleFactor: number): number {
  return setting === 'native' ? scaleFactor : setting
}

/**
 * Pair desktopCapturer sources with displays. On Windows each source carries
 * `display_id` (a string). If no source has one, fall back to enumeration
 * order, which matches screen.getAllDisplays() in practice.
 */
export function matchSources<S extends { display_id: string }>(
  sources: readonly S[],
  wantedIds: readonly number[],
  allDisplayIds: readonly number[]
): Map<number, S> {
  const out = new Map<number, S>()
  const noIds = sources.every((s) => !s.display_id)
  for (const id of wantedIds) {
    const byId = sources.find((s) => s.display_id && s.display_id === String(id))
    if (byId) {
      out.set(id, byId)
    } else if (noIds) {
      const idx = allDisplayIds.indexOf(id)
      if (idx >= 0 && idx < sources.length) out.set(id, sources[idx])
    }
  }
  return out
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
