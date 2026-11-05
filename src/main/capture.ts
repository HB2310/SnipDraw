import { desktopCapturer, screen, type Display, type NativeImage } from 'electron'
import { groupByNativeSize, matchSources, nativeSize, type DisplayLike } from '../shared/geometry'

export interface DisplayCapture {
  display: Display
  /** Full-resolution capture; getSize() is in physical pixels. */
  image: NativeImage
}

/** Display plus its physical origin, so nativeSize() can be exact. */
export function describeDisplay(display: Display): Display & DisplayLike {
  let physicalOrigin: { x: number; y: number } | undefined
  try {
    // Windows-only API: maps the DIP origin back to the monitor's real pixel origin.
    physicalOrigin = screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y })
  } catch {
    physicalOrigin = undefined
  }
  return { ...display, physicalOrigin }
}

/**
 * Capture every display at its native resolution.
 *
 * desktopCapturer scales all screens to fit a single thumbnailSize, so with
 * mixed resolutions/DPI we make one call per distinct native size (run
 * concurrently: each call takes ~350ms regardless of size) and keep only the
 * displays each call was sized for.
 */
export async function captureAllDisplays(): Promise<Map<number, DisplayCapture>> {
  const displays = screen.getAllDisplays().map(describeDisplay)
  const allIds = displays.map((d) => d.id)
  const out = new Map<number, DisplayCapture>()

  const groups = groupByNativeSize(displays)
  const results = await Promise.all(
    groups.map((g) => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: g.size, fetchWindowIcons: false }))
  )

  groups.forEach((group, i) => {
    const matched = matchSources(results[i], group.displays.map((d) => d.id), allIds)
    for (const display of group.displays) {
      const source = matched.get(display.id)
      if (!source || source.thumbnail.isEmpty()) continue
      out.set(display.id, { display, image: source.thumbnail })
    }
  })

  if (out.size === 0) throw new Error('Screen capture returned no images.')

  if (!process.env.SNIPDRAW_QUIET) {
    for (const { display, image } of out.values()) {
      const want = nativeSize(display as DisplayLike)
      const got = image.getSize()
      if (got.width !== want.width || got.height !== want.height) {
        console.warn(
          `[capture] display ${display.id}: requested ${want.width}x${want.height}, got ${got.width}x${got.height}`
        )
      }
    }
  }
  return out
}
