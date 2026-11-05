/**
 * Dev-only README screenshot generator (excluded from the installer):
 *   SNIPDRAW_SCREENSHOTS=1 npx electron-vite preview --skipBuild
 *
 * Covers one monitor with docs/screenshot-demo.html (fictional sample data, so
 * no real desktop ends up in the repo), then drives the real app with
 * synthetic input: snip a region, draw annotations in the editor, copy, open
 * Settings. Writes docs/screenshots/{overlay,editor,result,settings}.png.
 * Keep your hands off the mouse while it runs (about 15 seconds).
 */
import { app, BrowserWindow, clipboard, screen, type Display, type NativeImage } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fitImage, sceneImageSize } from '../shared/geometry'
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

const MAX_WIDTH = 1600

export async function runScreenshots(ctx: Ctx): Promise<void> {
  const root = app.getAppPath()
  const out = join(root, 'docs', 'screenshots')
  mkdirSync(out, { recursive: true })
  app.setPath('pictures', join(app.getPath('temp'), 'snipdraw-screenshots'))
  overrideConfig({ autoSaveHistory: false, exportScale: 'native' })
  const savedClipboard = await snapshotClipboard()
  let demo: BrowserWindow | null = null
  let ok = false

  try {
    await sleep(2500) // let the overlay and editor pages boot
    const target = pickDisplay()
    console.log(`[shots] using display ${target.id} ${target.bounds.width}x${target.bounds.height} @${target.scaleFactor}`)

    // 1. Neutral demo content over the whole target monitor.
    demo = new BrowserWindow({
      ...target.bounds,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      enableLargerThanScreen: true,
      backgroundColor: '#f4f6fb',
      webPreferences: { sandbox: true, contextIsolation: true }
    })
    demo.setAlwaysOnTop(true, 'pop-up-menu') // above apps, below SnipDraw's overlay
    await demo.loadFile(join(root, 'docs', 'screenshot-demo.html'))
    placeWindow(demo, target.bounds)
    demo.show()
    await sleep(900)
    const rect = (id: string): Promise<Box> =>
      demo!.webContents.executeJavaScript(
        `(() => { const b = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } })()`
      )
    const area = await rect('snip-target')
    const kpi = await rect('kpi-highlight')
    const peak = await rect('bar-peak')
    const sel: Box = { x: Math.round(area.x - 18), y: Math.round(area.y - 18), width: Math.round(area.width + 36), height: Math.round(area.height + 36) }

    // 2. Snip: overlay mid-drag, then release.
    const result = await new Promise<SnipResult>((resolve, reject) => {
      ctx.snips.onSnipComplete = resolve
      void (async () => {
        try {
          await ctx.snips.start()
          const ow = ctx.overlays.getWindow(target.id)
          if (!ow?.isVisible()) throw new Error('overlay not visible')
          await drag(ow, sel.x, sel.y, sel.x + sel.width, sel.y + sel.height)
          await sleep(250)
          // Crop to the content (the demo page only fills the left of a wide monitor), 16:9.
          const full = await ow.webContents.capturePage()
          const k = full.getSize().width / target.bounds.width
          const w = Math.min(full.getSize().width, Math.round((sel.x + sel.width + 280) * k))
          const h = Math.min(full.getSize().height, Math.round((w * 9) / 16))
          save(out, 'overlay.png', full.crop({ x: 0, y: 0, width: w, height: h }))
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
    // demo-page (= screen DIP) coordinates -> editor viewport coordinates
    const toEditor = (x: number, y: number): { x: number; y: number } => ({
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
    const stroke = async (a: { x: number; y: number }, b: { x: number; y: number }): Promise<void> => {
      wc.sendInputEvent({ type: 'mouseMove', x: a.x, y: a.y })
      wc.sendInputEvent({ type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 })
      for (let i = 1; i <= 12; i++) {
        const x = Math.round(a.x + ((b.x - a.x) * i) / 12)
        const y = Math.round(a.y + ((b.y - a.y) * i) / 12)
        wc.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftbuttondown'] })
        await sleep(16)
      }
      wc.sendInputEvent({ type: 'mouseUp', x: b.x, y: b.y, button: 'left', clickCount: 1 })
      await sleep(200)
    }

    // Rectangle around the first KPI card.
    await key('r')
    await stroke(toEditor(kpi.x - 8, kpi.y - 8), toEditor(kpi.x + kpi.width + 8, kpi.y + kpi.height + 8))
    // Arrow pointing at the peak bar.
    const tip = toEditor(peak.x + peak.width / 2, peak.y + 6)
    const tail = { x: tip.x - 230, y: tip.y - 40 }
    await key('a')
    await stroke(tail, tip)
    // Label at the arrow's tail.
    await key('t')
    const at = { x: tail.x - 175, y: tail.y - 30 }
    wc.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    await sleep(300)
    for (const ch of 'Best week yet!') {
      wc.sendInputEvent({ type: 'char', keyCode: ch })
      await sleep(15)
    }
    await sleep(200)
    await key('Escape') // finish the text
    // Click empty canvas (right of the hint line, above the image) to deselect,
    // then pick the Arrow tool again: the editor's state right after a snip.
    wc.sendInputEvent({ type: 'mouseDown', x: cw - 60, y: 75, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: cw - 60, y: 75, button: 'left', clickCount: 1 })
    await sleep(200)
    await key('a')
    await sleep(500)
    save(out, 'editor.png', await wc.capturePage())

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
    demo?.destroy()
    if (savedClipboard.length) await clipboard.write(savedClipboard).catch(() => undefined)
    app.exit(ok ? 0 : 1)
  }
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
