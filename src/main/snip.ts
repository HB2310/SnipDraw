import { screen } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MIN_SELECTION_PX, viewportRectToPixels } from '../shared/geometry'
import type { OverlaySelection, Rect } from '../shared/types'
import { captureAllDisplays, type DisplayCapture } from './capture'
import { getConfig } from './config'
import type { EditorWindow } from './editor'
import { registerEscape } from './hotkey'
import type { OverlayManager } from './overlay'
import { historyDir, timestampName } from './paths'
import { ensureScreenCapturePermission } from './permissions'

interface ActiveSnip {
  session: number
  /** null once a selection has been taken (or while still capturing). */
  captures: Map<number, DisplayCapture> | null
  releaseEsc: () => void
  t0: number
}

export interface SnipResult {
  displayId: number
  rect: Rect
  png: Buffer
  timings: { captureMs: number; overlayMs: number; editorMs?: number }
}

/** hotkey -> capture -> overlays -> selection -> crop -> editor. */
export class SnipController {
  private session = 0
  private active: ActiveSnip | null = null
  private captureMs = 0
  private overlayMs = 0
  private checkingPermission = false
  /** Test hook: called after the editor is shown for a snip. */
  onSnipComplete: ((r: SnipResult) => void) | null = null

  constructor(
    private readonly overlays: OverlayManager,
    private readonly editor: EditorWindow,
    private readonly notify: (title: string, message: string) => void
  ) {}

  get busy(): boolean {
    return this.active !== null
  }

  async start(): Promise<void> {
    if (this.active || this.checkingPermission) return // already snipping
    this.checkingPermission = true
    const allowed = await ensureScreenCapturePermission().finally(() => (this.checkingPermission = false))
    if (!allowed || this.active) return
    const t0 = performance.now()
    const session = ++this.session
    const releaseEsc = registerEscape(() => this.cancel())
    this.active = { session, captures: null, releaseEsc, t0 }

    let captures: Map<number, DisplayCapture>
    try {
      captures = await captureAllDisplays()
    } catch (err) {
      this.finish()
      this.notify('Snip failed', `Could not capture the screen: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    if (this.active?.session !== session) return // cancelled while capturing
    this.active.captures = captures
    this.captureMs = performance.now() - t0

    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const focusId = captures.has(cursor.id) ? cursor.id : [...captures.keys()][0]
    await this.overlays.show(session, captures, focusId)
    this.overlayMs = performance.now() - t0
    log(`[snip] captured ${captures.size} display(s) in ${ms(this.captureMs)}, overlay up at ${ms(this.overlayMs)}`)
  }

  async select(sel: OverlaySelection): Promise<void> {
    const a = this.active
    if (!a || sel.session !== a.session || !a.captures) return
    const cap = a.captures.get(sel.displayId)
    if (!cap) return
    a.captures = null // consume: ignore duplicate selections

    const bitmap = cap.image.getSize()
    let rect = viewportRectToPixels(sel.rect, sel.viewport, bitmap)
    if (rect.width < MIN_SELECTION_PX || rect.height < MIN_SELECTION_PX) {
      // A click (no real drag) snips the whole display.
      rect = { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
    }

    const cropped = cap.image.crop(rect)
    const got = cropped.getSize()
    if (got.width !== rect.width || got.height !== rect.height) {
      console.warn(`[snip] crop size mismatch: wanted ${rect.width}x${rect.height}, got ${got.width}x${got.height}`)
    }
    const png = cropped.toPNG()
    const tSel = performance.now()

    // Show the editor *before* hiding overlays so focus goes straight to it
    // rather than bouncing back to the app underneath (e.g. a game).
    await this.editor.open(png, got, cap.display)
    const editorMs = performance.now() - tSel
    await this.overlays.hideAll()
    this.finish()
    log(`[snip] ${got.width}x${got.height} on display ${cap.display.id}; editor shown ${ms(editorMs)} after mouse-up`)

    if (getConfig().autoSaveHistory) void saveHistory(png)
    this.onSnipComplete?.({
      displayId: cap.display.id,
      rect,
      png,
      timings: { captureMs: this.captureMs, overlayMs: this.overlayMs, editorMs }
    })
  }

  cancel(): void {
    if (!this.active) return
    this.finish()
    void this.overlays.hideAll()
  }

  private finish(): void {
    this.active?.releaseEsc()
    this.active = null
  }
}

async function saveHistory(png: Buffer): Promise<void> {
  try {
    const dir = historyDir()
    await mkdir(dir, { recursive: true })
    const base = timestampName()
    for (let i = 0; i < 100; i++) {
      const file = join(dir, i === 0 ? `${base}.png` : `${base}-${i + 1}.png`)
      try {
        await writeFile(file, png, { flag: 'wx' })
        return
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }
    }
  } catch (err) {
    console.error('[history] failed to save snip', err)
  }
}

function ms(n: number): string {
  return `${Math.round(n)}ms`
}

function log(msg: string): void {
  if (!process.env.SNIPDRAW_QUIET) console.log(msg)
}
