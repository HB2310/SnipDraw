/**
 * Dev-only README screenshot generator (excluded from the installer):
 *   SNIPDRAW_SCREENSHOTS=1 npx electron-vite preview --skipBuild
 *
 * Stages a neutral demo desktop on one monitor (docs/screenshot-demo/: a
 * wallpaper plus two fictional app windows, so no real desktop ends up in the
 * repo), then drives the real app with synthetic input: snip part of a window,
 * draw annotations in the editor, copy, open Settings. The overlay and editor
 * shots are full-monitor captures, so they show SnipDraw over the desktop the
 * way you actually see it. Writes docs/screenshots/{overlay,editor,result,settings}.png.
 * Keep your hands off the mouse while it runs (about 20 seconds).
 */
import { app, BrowserWindow, clipboard, screen, type Display, type NativeImage } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fitImage, sceneImageSize } from '../shared/geometry'
import { captureAllDisplays } from './capture'
import { overrideConfig } from './config'
import type { EditorWindow } from './editor'
import type { OverlayManager } from './overlay'
import { drag, mouseUp, readClipboardPng, sleep, snapshotClipboard, until } from './selftest'
import { openSettings, settingsWebContents } from './settings-window'
import type { SnipController, SnipResult } from './snip'
import { placeWindow } from './window-utils'

interface Ctx {
  snips: SnipController
  overlays: OverlayManager
  editor: EditorWindow
}

type Box = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }

const MAX_WIDTH = 1600

export async function runScreenshots(ctx: Ctx): Promise<void> {
  const root = app.getAppPath()
  const demoDir = join(root, 'docs', 'screenshot-demo')
  const out = join(root, 'docs', 'screenshots')
  mkdirSync(out, { recursive: true })
  app.setPath('pictures', join(app.getPath('temp'), 'snipdraw-screenshots'))
  overrideConfig({ autoSaveHistory: false, exportScale: 'native' })
  const savedClipboard = await snapshotClipboard()
  const staged: BrowserWindow[] = []
  let ok = false

  try {
    await sleep(2500) // let the overlay and editor pages boot
    const target = pickDisplay()
    const b = target.bounds
    console.log(`[shots] using display ${target.id} ${b.width}x${b.height} @${target.scaleFactor}`)

    // 1. Demo desktop: wallpaper over the whole monitor (taskbar included),
    //    then two app windows that draw their own neutral chrome.
    const sx = b.width / 2560
    const sy = b.height / 1440
    const at = (x: number, y: number, w: number, h: number): Box => ({
      x: Math.round(b.x + x * sx),
      y: Math.round(b.y + y * sy),
      width: Math.round(w * sx),
      height: Math.round(h * sy)
    })
    const stage = async (page: string, rect: Box, transparent: boolean): Promise<BrowserWindow> => {
      const w = new BrowserWindow({
        ...rect,
        show: false,
        frame: false,
        transparent,
        backgroundColor: transparent ? '#00000000' : '#1b1f3b',
        resizable: false,
        skipTaskbar: true,
        hasShadow: false,
        roundedCorners: false,
        enableLargerThanScreen: true,
        webPreferences: { sandbox: true, contextIsolation: true }
      })
      w.setAlwaysOnTop(true, 'pop-up-menu') // above other apps, below SnipDraw's overlay
      await w.loadFile(join(demoDir, page))
      placeWindow(w, rect)
      w.showInactive()
      staged.push(w)
      return w
    }
    await stage('wallpaper.html', { ...b }, false)
    const dashRect = at(140, 100, 1520, 960)
    const dash = await stage('dashboard.html', dashRect, true)
    await stage('notes.html', at(1570, 360, 760, 620), true)
    await sleep(1000)

    // Element rects in monitor coordinates (= overlay viewport coordinates).
    const rect = async (id: string): Promise<Box> => {
      const r: Box = await dash.webContents.executeJavaScript(
        `(() => { const b = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } })()`
      )
      return { ...r, x: r.x + dashRect.x - b.x, y: r.y + dashRect.y - b.y }
    }
    const chart = await rect('chart-card')
    const peak = await rect('bar-peak')
    const pad = 14
    const sel: Box = {
      x: Math.round(chart.x - pad),
      y: Math.round(chart.y - pad),
      width: Math.round(chart.width + pad * 2),
      height: Math.round(chart.height + pad * 2)
    }

    // 2. Snip: capture the desktop mid-drag, then release.
    const result = await new Promise<SnipResult>((resolve, reject) => {
      ctx.snips.onSnipComplete = resolve
      void (async () => {
        try {
          await ctx.snips.start()
          const ow = ctx.overlays.getWindow(target.id)
          if (!ow?.isVisible()) throw new Error('overlay not visible')
          // Let the editor (a normal window) open above the demo windows later.
          for (const w of staged) w.setAlwaysOnTop(false)
          await drag(ow, sel.x, sel.y, sel.x + sel.width, sel.y + sel.height)
          await sleep(300)
          save(out, 'overlay.png', await captureMonitor(target))
          await mouseUp(ow, sel.x + sel.width, sel.y + sel.height)
        } catch (err) {
          reject(err)
        }
      })()
    })
    ctx.snips.onSnipComplete = null

    // 3. Annotate in the editor with real (synthetic) input.
    const ew = ctx.editor.browserWindow()!
    await until(() => ew.isVisible(), 3000, 'editor visible')
    await sleep(800)
    const [cw, ch] = ew.getContentSize()
    const img = sceneImageSize({ width: result.rect.width, height: result.rect.height }, target.scaleFactor)
    const view = fitImage(img, { width: cw, height: ch }, target.scaleFactor)
    // monitor coordinates -> editor viewport coordinates
    const toEditor = (x: number, y: number): Point => ({
      x: Math.round((-img.width / 2 + (x - sel.x) + view.scrollX) * view.zoom),
      y: Math.round((-img.height / 2 + (y - sel.y) + view.scrollY) * view.zoom)
    })
    const wc = ew.webContents
    const key = async (keyCode: string): Promise<void> => {
      wc.sendInputEvent({ type: 'keyDown', keyCode })
      wc.sendInputEvent({ type: 'char', keyCode })
      wc.sendInputEvent({ type: 'keyUp', keyCode })
      await sleep(120)
    }
    const click = async (p: Point): Promise<void> => {
      wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
      await sleep(250)
    }
    const stroke = async (a: Point, z: Point): Promise<void> => {
      wc.sendInputEvent({ type: 'mouseMove', x: a.x, y: a.y })
      wc.sendInputEvent({ type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 })
      for (let i = 1; i <= 12; i++) {
        const x = Math.round(a.x + ((z.x - a.x) * i) / 12)
        const y = Math.round(a.y + ((z.y - a.y) * i) / 12)
        wc.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftbuttondown'] })
        await sleep(16)
      }
      wc.sendInputEvent({ type: 'mouseUp', x: z.x, y: z.y, button: 'left', clickCount: 1 })
      await sleep(200)
    }

    // Box around the peak bar, an arrow pointing at it, and a label.
    await key('r')
    await stroke(toEditor(peak.x - 10, peak.y - 12), toEditor(peak.x + peak.width + 10, peak.y + peak.height + 4))
    const tip = toEditor(peak.x - 16, peak.y + 28)
    const tail = { x: tip.x - 220, y: tip.y - 20 }
    await key('a')
    await stroke(tail, tip)
    await key('t')
    await click({ x: tail.x - 190, y: tail.y - 14 })
    for (const c of 'Best week yet!') {
      wc.sendInputEvent({ type: 'char', keyCode: c })
      await sleep(15)
    }
    await sleep(200)
    await key('Escape') // finish the text
    // Click empty canvas (right of the hint line, above the image) to deselect,
    // then pick the Selection tool: the editor's state right after a snip.
    await click({ x: cw - 60, y: 75 })
    await key('v')
    await sleep(600)
    save(out, 'editor.png', await captureMonitor(target))

    // 4. Copy: the exported PNG is the "result" image.
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['control'] })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['control'] })
    await until(() => !ew.isVisible(), 4000, 'editor hidden after copy')
    save(out, 'result.png', await readClipboardPng())

    // 5. Settings window, showing the default settings.
    overrideConfig({ autoSaveHistory: true, exportScale: 2 })
    openSettings()
    await until(() => !!settingsWebContents(), 3000, 'settings window')
    await sleep(1500)
    save(out, 'settings.png', await settingsWebContents()!.capturePage())
    BrowserWindow.fromWebContents(settingsWebContents()!)?.close()
    ok = true
    console.log(`[shots] wrote ${out}`)
  } catch (err) {
    console.error('[shots] failed:', err)
  } finally {
    for (const w of staged) if (!w.isDestroyed()) w.destroy()
    if (savedClipboard.length) await clipboard.write(savedClipboard).catch(() => undefined)
    app.exit(ok ? 0 : 1)
  }
}

/** Full-resolution capture of one monitor, through the same path snips use. */
async function captureMonitor(display: Display): Promise<NativeImage> {
  const shot = (await captureAllDisplays()).get(display.id)
  if (!shot) throw new Error(`could not capture display ${display.id}`)
  return shot.image
}

/** Prefer a 16:9 monitor at 100% (crisp, README-friendly); else the primary display. */
function pickDisplay(): Display {
  const all = screen.getAllDisplays()
  const want = process.env.SNIPDRAW_SCREENSHOT_DISPLAY
  return (
    (want && all.find((d) => String(d.id) === want)) ||
    all.find((d) => d.scaleFactor === 1 && Math.abs(d.bounds.width / d.bounds.height - 16 / 9) < 0.02) ||
    screen.getPrimaryDisplay()
  )
}

/** Save as PNG, scaled down to at most MAX_WIDTH px wide for the README. */
function save(dir: string, name: string, image: NativeImage): void {
  const { width } = image.getSize()
  const out = width > MAX_WIDTH ? image.resize({ width: MAX_WIDTH, quality: 'best' }) : image
  writeFileSync(join(dir, name), out.toPNG())
  console.log(`[shots] ${name} ${out.getSize().width}x${out.getSize().height}`)
}
