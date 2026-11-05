/**
 * Dev-only end-to-end self-test (never bundled into the flow of a normal run):
 *   SNIPDRAW_SELFTEST=1 SNIPDRAW_SELFTEST_OUT=<dir> npm run dev
 *
 * Drives the real pipeline with synthetic input: start snip -> overlays ->
 * drag on the display under the cursor -> crop -> editor -> Ctrl+Enter ->
 * clipboard, then compares the clipboard image with the crop pixel-for-pixel,
 * checks Esc cancels a snip, and writes a JSON report + PNGs to the out dir.
 */
import { app, ClipboardItem, clipboard, nativeImage, screen, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorBounds, nativeSize } from '../shared/geometry'
import { captureAllDisplays, describeDisplay } from './capture'
import { getConfig, overrideConfig } from './config'
import type { EditorWindow } from './editor'
import type { OverlayManager } from './overlay'
import { blockedRequests } from './security'
import type { SnipController, SnipResult } from './snip'

interface Ctx {
  snips: SnipController
  overlays: OverlayManager
  editor: EditorWindow
  hotkeyError: string | null
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function until(fn: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`)
    await sleep(10)
  }
}

export async function runSelfTest(ctx: Ctx): Promise<void> {
  const out = process.env.SNIPDRAW_SELFTEST_OUT || join(app.getPath('temp'), 'snipdraw-selftest')
  mkdirSync(out, { recursive: true })
  app.setPath('pictures', join(out, 'pictures')) // keep history writes out of the real Pictures
  const report: Record<string, unknown> = { ok: false, hotkeyError: ctx.hotkeyError }
  const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
  const check = (name: string, pass: boolean, detail?: unknown): void => {
    checks.push({ name, pass, detail })
    console.log(`[selftest] ${pass ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`)
  }

  const savedClipboard = await snapshotClipboard()
  try {
    await sleep(2500) // let overlay/editor pages finish booting
    const displays = screen.getAllDisplays().map(describeDisplay)
    report.displays = displays.map((d) => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
      native: nativeSize(d)
    }))

    // --- 1. snip on every display at native export scale (pixel-exact check),
    //        then once at 2x on the primary display ----------------------------
    const cases = [
      ...displays.map((d) => ({ exportScale: 'native' as const, target: d })),
      { exportScale: 2 as const, target: displays[0] }
    ]
    for (const { exportScale, target } of cases) {
      const tag = `${exportScale} d${target.id} @${target.scaleFactor}`
      overrideConfig({ exportScale, autoSaveHistory: true })
      const result = await new Promise<SnipResult>((resolve, reject) => {
        ctx.snips.onSnipComplete = resolve
        void (async () => {
          try {
            // Give the previous case's hidden editor time to leave the screen. Capturing
            // straight after hide() gave a frame that didn't match the overlay's on macOS.
            await sleep(1000)
            // Reference frame (taken before the overlay is up) to verify dimming against.
            const reference = await captureAllDisplays()
            const tStart = performance.now()
            await ctx.snips.start()
            const tOverlay = performance.now() - tStart
            const win = ctx.overlays.getWindow(target.id)
            if (!win || !win.isVisible()) throw new Error('overlay not visible')
            const ob = win.getBounds()
            // At fractional DPI Windows may make the window 1-2 DIP larger; it must still cover the display.
            const covers =
              ob.x === target.bounds.x &&
              ob.y === target.bounds.y &&
              ob.width >= target.bounds.width &&
              ob.height >= target.bounds.height &&
              ob.width - target.bounds.width <= 2 &&
              ob.height - target.bounds.height <= 2
            check(`[${tag}] overlay covers display`, covers, { overlay: ob, display: target.bounds })
            check(`[${tag}] hotkey->overlay visible < 1000ms`, tOverlay < 1000, Math.round(tOverlay))
            await drag(win, 60, 80, 460, 330)
            // Read back the rectangle the overlay actually drew: if the real
            // mouse moves over the overlay mid-test it legitimately changes the
            // live selection (the crop still uses the synthetic mouse-up).
            const drawn = (await win.webContents.executeJavaScript(
              `(() => { const r = document.querySelector('.selection')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height, dpr: devicePixelRatio } : null })()`
            )) as { x: number; y: number; width: number; height: number; dpr: number } | null
            const shot = await win.webContents.capturePage()
            writeFileSync(join(out, `overlay-${exportScale}-d${target.id}.png`), shot.toPNG())
            const ref = reference.get(target.id)?.image
            if (ref && drawn) {
              const k = shot.getSize().width / win.getContentBounds().width
              const sel = { x: drawn.x * k, y: drawn.y * k, width: drawn.width * k, height: drawn.height * k }
              check(`[${tag}] overlay: selection clear, rest dimmed`, ...dimCheck(ref, shot, sel))
            } else {
              check(`[${tag}] overlay: selection drawn`, false, { drawn })
            }
            await mouseUp(win, 460, 330)
          } catch (err) {
            reject(err)
          }
        })()
      })
      ctx.snips.onSnipComplete = null

      const display = displays.find((d) => d.id === result.displayId)!
      const expectPx = {
        x: Math.round(60 * display.scaleFactor),
        y: Math.round(80 * display.scaleFactor),
        width: Math.round(460 * display.scaleFactor) - Math.round(60 * display.scaleFactor),
        height: Math.round(330 * display.scaleFactor) - Math.round(80 * display.scaleFactor)
      }
      check(`[${tag}] crop rect in physical px`, sameBounds(result.rect, expectPx), { got: result.rect, want: expectPx })
      check(`[${tag}] mouse-up -> editor shown < 300ms`, (result.timings.editorMs ?? 1e9) < 300, result.timings)
      writeFileSync(join(out, `crop-${exportScale}-d${target.id}.png`), result.png)

      const ew = ctx.editor.browserWindow()!
      await until(() => ew.isVisible(), 2000, 'editor visible')
      const wantBounds = editorBounds({ width: result.rect.width, height: result.rect.height }, display)
      // Windows rounds window sizes at fractional DPI, so allow 2 DIP of slack.
      check(`[${tag}] editor bounds (±2)`, nearBounds(ew.getBounds(), wantBounds, 2), { got: ew.getBounds(), want: wantBounds })
      await sleep(50) // right after it appears: the snip must already be painted
      const editorShot = await ew.webContents.capturePage()
      writeFileSync(join(out, `editor-${exportScale}-d${target.id}.png`), editorShot.toPNG())
      // The snip must appear in the editor with its true colors (no dark-mode
      // filtering) and, at 100% zoom, at exactly 1 snip px per screen px.
      check(`[${tag}] editor shows snip pixels unaltered`, ...findInImage(editorShot, nativeImage.createFromBuffer(result.png)))
      const chrome = (await ew.webContents.executeJavaScript(
        `(() => { const el = document.querySelector('.App-toolbar') || document.querySelector('.Island'); if (!el) return null; const m = getComputedStyle(el).backgroundColor.match(/[0-9.]+/g).map(Number); return { bg: getComputedStyle(el).backgroundColor, lum: (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 } })()`
      )) as { bg: string; lum: number } | null
      check(`[${tag}] editor UI is dark`, !!chrome && chrome.lum < 0.3, chrome)

      const activeTool = await ew.webContents.executeJavaScript(
        `document.querySelector('.ToolIcon_type_radio[data-testid="toolbar-selection"]')?.checked ?? null`
      )
      check(`[${tag}] selection tool active`, activeTool === true, activeTool)
      const fontsOk = await ew.webContents.executeJavaScript(
        `document.fonts.ready.then(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))`
      )
      report[`fonts-${tag}`] = fontsOk

      // Ctrl+Enter -> clipboard + hide
      clipboard.clear()
      ew.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['control'] })
      ew.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['control'] })
      await until(() => !ew.isVisible(), 3000, 'editor hidden after copy')
      const clip = await readClipboardPng()
      writeFileSync(join(out, `clipboard-${exportScale}-d${target.id}.png`), clip.toPNG())
      const scale = exportScale === 'native' ? 1 : exportScale / display.scaleFactor
      const want = { width: Math.round(result.rect.width * scale), height: Math.round(result.rect.height * scale) }
      check(`[${tag}] clipboard image size`, sameSize(clip.getSize(), want), { got: clip.getSize(), want })

      if (exportScale === 'native') {
        const diff = pixelDiff(nativeImage.createFromBuffer(result.png), clip)
        check(`[${tag}] clipboard pixels == crop pixels`, diff.max <= 2, diff)
      }
    }

    // --- 2. Esc cancels ------------------------------------------------------
    await ctx.snips.start()
    const cur = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const ow = ctx.overlays.getWindow(cur.id)!
    ow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    ow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await until(() => !ow.isVisible() && !ctx.snips.busy, 2000, 'overlay hidden after Esc')
    check('Esc cancels snip', true)

    // --- 3. right-click cancels ---------------------------------------------
    await ctx.snips.start()
    ow.webContents.sendInputEvent({ type: 'mouseDown', x: 200, y: 200, button: 'right', clickCount: 1 })
    ow.webContents.sendInputEvent({ type: 'mouseUp', x: 200, y: 200, button: 'right', clickCount: 1 })
    await until(() => !ow.isVisible() && !ctx.snips.busy, 2000, 'overlay hidden after right-click')
    check('right-click cancels snip', true)

    await sleep(300)
    check('no network requests attempted', blockedRequests.length === 0, blockedRequests)
    report.config = getConfig()
    report.ok = checks.every((c) => c.pass)
  } catch (err) {
    check('selftest ran to completion', false, String(err))
  }
  report.checks = checks
  if (savedClipboard.length) {
    await clipboard.write(savedClipboard).catch((err) => console.warn(`[selftest] could not restore clipboard: ${String(err)}`))
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`[selftest] ${report.ok ? 'ALL PASSED' : 'FAILURES'} - report at ${join(out, 'report.json')}`)
  app.exit(report.ok ? 0 : 1)
}

export async function drag(win: BrowserWindow, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const wc = win.webContents
  wc.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 })
  wc.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 })
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps)
    const y = Math.round(y0 + ((y1 - y0) * i) / steps)
    wc.sendInputEvent({ type: 'mouseMove', x, y, button: 'left' } as Electron.MouseInputEvent)
    await sleep(16)
  }
  await sleep(100)
}

export async function mouseUp(win: BrowserWindow, x: number, y: number): Promise<void> {
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
}

function sameBounds(a: Electron.Rectangle, b: Electron.Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function nearBounds(a: Electron.Rectangle, b: Electron.Rectangle, tol: number): boolean {
  return (
    Math.abs(a.x - b.x) <= tol &&
    Math.abs(a.y - b.y) <= tol &&
    Math.abs(a.width - b.width) <= tol &&
    Math.abs(a.height - b.height) <= tol
  )
}

/**
 * Sample a grid over the overlay screenshot: inside the selection pixels must
 * match the reference capture; outside they must be ~55% of it (45% black
 * dim). Pixels that changed on screen between the two captures (clocks,
 * video) are tolerated by requiring 97% of samples to match.
 */
function dimCheck(
  ref: Electron.NativeImage,
  shot: Electron.NativeImage,
  sel: { x: number; y: number; width: number; height: number }
): [boolean, unknown] {
  const rs = ref.getSize()
  const ss = shot.getSize()
  // The overlay may extend 1-2 px past the display (DPI rounding); compare the display area.
  if (ss.width < rs.width || ss.height < rs.height || ss.width - rs.width > 4 || ss.height - rs.height > 4)
    return [false, { reason: 'size mismatch', ref: rs, shot: ss }]
  const a = ref.toBitmap()
  const b = shot.toBitmap()
  let inside = 0, insideOk = 0, outside = 0, outsideOk = 0
  const margin = 3
  for (let y = 5; y < rs.height; y += 37) {
    for (let x = 5; x < rs.width; x += 41) {
      const inSel = x >= sel.x + margin && x < sel.x + sel.width - margin && y >= sel.y + margin && y < sel.y + sel.height - margin
      const onEdge = !inSel && x >= sel.x - margin && x < sel.x + sel.width + margin && y >= sel.y - margin && y < sel.y + sel.height + margin
      if (onEdge) continue
      const i = (y * rs.width + x) * 4
      const j = (y * ss.width + x) * 4
      let ok = true
      for (let c = 0; c < 3; c++) {
        const want = inSel ? a[i + c] : a[i + c] * 0.55
        if (Math.abs(b[j + c] - want) > 4) ok = false
      }
      if (inSel) {
        inside++
        if (ok) insideOk++
      } else {
        outside++
        if (ok) outsideOk++
      }
    }
  }
  const inRatio = inside ? insideOk / inside : 1
  const outRatio = outside ? outsideOk / outside : 1
  return [inRatio >= 0.97 && outRatio >= 0.97, { inside: `${insideOk}/${inside}`, outside: `${outsideOk}/${outside}` }]
}

function sameSize(a: Electron.Size, b: Electron.Size): boolean {
  return a.width === b.width && a.height === b.height
}

function pixelDiff(a: Electron.NativeImage, b: Electron.NativeImage): { max: number; mean: number; sizeMatch: boolean } {
  const sa = a.getSize()
  const sb = b.getSize()
  if (!sameSize(sa, sb)) return { max: 255, mean: 255, sizeMatch: false }
  const da = a.toBitmap()
  const db = b.toBitmap()
  let max = 0
  let sum = 0
  let n = 0
  for (let i = 0; i < da.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(da[i + c] - db[i + c])
      if (d > max) max = d
      sum += d
      n++
    }
  }
  return { max, mean: Number((sum / n).toFixed(3)), sizeMatch: true }
}

export async function readClipboardPng(): Promise<Electron.NativeImage> {
  const items = await clipboard.read()
  for (const item of items) {
    if (item.types.includes('image/png')) {
      const blob = (await item.getType('image/png')) as Blob
      return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
    }
  }
  return nativeImage.createEmpty()
}

/**
 * Copy the clipboard's contents into fresh ClipboardItems: Electron refuses to
 * write back the items returned by clipboard.read() directly.
 */
export async function snapshotClipboard(): Promise<ClipboardItem[]> {
  const out: ClipboardItem[] = []
  for (const item of await clipboard.read().catch(() => [])) {
    const data: Record<string, Blob> = {}
    for (const type of item.types) {
      try {
        const v = await item.getType(type)
        if (v instanceof Blob) data[type] = v
      } catch {
        /* skip formats that can't be read back */
      }
    }
    if (Object.keys(data).length) out.push(new ClipboardItem(data))
  }
  return out
}

/**
 * Locate `needle` inside `hay` (exact-size placement, coarse-to-fine search on
 * a sparse grid) and report how closely the pixels match there.
 */
function findInImage(hay: Electron.NativeImage, needle: Electron.NativeImage): [boolean, unknown] {
  const H = hay.getSize()
  const N = needle.getSize()
  if (N.width > H.width || N.height > H.height) return [false, { reason: 'needle larger than haystack', H, N }]
  const h = hay.toBitmap()
  const n = needle.toBitmap()
  const score = (ox: number, oy: number, step: number): number => {
    let s = 0
    for (let y = 0; y < N.height; y += step)
      for (let x = 0; x < N.width; x += step) {
        const i = (y * N.width + x) * 4
        const j = ((y + oy) * H.width + x + ox) * 4
        s += Math.abs(n[i] - h[j]) + Math.abs(n[i + 1] - h[j + 1]) + Math.abs(n[i + 2] - h[j + 2])
      }
    return s
  }
  let best = { s: Infinity, ox: 0, oy: 0 }
  for (let oy = 0; oy <= H.height - N.height; oy += 2)
    for (let ox = 0; ox <= H.width - N.width; ox += 2) {
      const s = score(ox, oy, 16)
      if (s < best.s) best = { s, ox, oy }
    }
  const coarse = best
  for (let oy = Math.max(0, coarse.oy - 3); oy <= Math.min(H.height - N.height, coarse.oy + 3); oy++)
    for (let ox = Math.max(0, coarse.ox - 3); ox <= Math.min(H.width - N.width, coarse.ox + 3); ox++) {
      const s = score(ox, oy, 1)
      if (s < best.s || best === coarse) best = { s, ox, oy }
    }
  let max = 0
  let sum = 0
  for (let y = 0; y < N.height; y++)
    for (let x = 0; x < N.width; x++)
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(n[(y * N.width + x) * 4 + c] - h[((y + best.oy) * H.width + x + best.ox) * 4 + c])
        if (d > max) max = d
        sum += d
      }
  const mean = sum / (N.width * N.height * 3)
  return [mean < 1 && max <= 8, { at: { x: best.ox, y: best.oy }, mean: Number(mean.toFixed(3)), max }]
}
