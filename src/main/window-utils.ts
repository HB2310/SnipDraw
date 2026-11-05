import type { BrowserWindow, Rectangle } from 'electron'

/**
 * setBounds that survives mixed-DPI moves. When a window crosses onto a
 * monitor with a different scale factor, Windows sends WM_DPICHANGED and the
 * first setBounds can land with the size scaled by the DPI ratio. Re-applying
 * once the window is on the target monitor fixes it.
 */
export function placeWindow(win: BrowserWindow, bounds: Rectangle): void {
  win.setBounds(bounds)
  if (!sameRect(win.getBounds(), bounds)) win.setBounds(bounds)
}

export function sameRect(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Resolve with the value, or with `fallback` after `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(fallback)
      }
    )
  })
}
