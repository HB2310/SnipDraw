import { app, BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, nativeImage, type Display, type WebContents } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { editorBounds } from '../shared/geometry'
import { IPC } from '../shared/ipc'
import type { EditorSnip, SaveRequest, SaveResult } from '../shared/types'
import { getConfig } from './config'
import { isMac, pageUrl, preloadPath, snipDrawDir, timestampName, windowIconPath } from './paths'
import { placeWindow, withTimeout } from './window-utils'

/**
 * The single editor window. It is created hidden at startup with Excalidraw
 * already booted, so opening a snip is: resize, push the image, show.
 */
export class EditorWindow {
  private win: BrowserWindow | null = null
  private loaded: Promise<void> = Promise.resolve()
  private snipCounter = 0
  private waiter: { id: number; resolve: () => void } | null = null
  private allowClose = false

  init(): void {
    ipcMain.on(IPC.editorLoaded, (e, id: number) => {
      if (this.owns(e.sender) && this.waiter?.id === id) {
        this.waiter.resolve()
        this.waiter = null
      }
    })
    ipcMain.handle(IPC.editorCopy, async (e, png: Uint8Array) => {
      if (!this.owns(e.sender)) return false
      const bytes = Buffer.from(png)
      if (nativeImage.createFromBuffer(bytes).isEmpty()) return false
      // Electron 45 replaced clipboard.writeImage with the async ClipboardItem API.
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })])
      this.hide()
      return true
    })
    ipcMain.handle(IPC.editorSave, (e, req: SaveRequest) => (this.owns(e.sender) ? this.save(req) : { saved: false }))
    ipcMain.on(IPC.editorHide, (e) => {
      if (this.owns(e.sender)) this.hide()
    })
    ipcMain.handle(IPC.editorConfirmDiscard, async (e) => {
      if (!this.owns(e.sender) || !this.win) return false
      const { response } = await dialog.showMessageBox(this.win, {
        type: 'question',
        buttons: ['Discard', 'Keep editing'],
        defaultId: 1,
        cancelId: 1,
        title: 'SnipDraw',
        message: 'Discard your annotations?',
        detail: 'This snip has changes that were not copied or saved.',
        noLink: true
      })
      return response === 0
    })
    this.create()
  }

  private create(): void {
    const win = new BrowserWindow({
      width: 1000,
      height: 700,
      show: false,
      title: 'SnipDraw',
      icon: windowIconPath(),
      backgroundColor: '#121212',
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Keep Excalidraw warm while hidden so the first frame after show is ready.
        backgroundThrottling: false,
        spellcheck: false
      }
    })
    if (!isMac) win.setMenu(null)
    win.on('close', (e) => {
      if (this.allowClose) return
      // Treat the title-bar X like Esc: hide (after confirming if dirty).
      e.preventDefault()
      win.webContents.send(IPC.editorRequestClose)
    })
    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
    if (!process.env.ELECTRON_RENDERER_URL) {
      win.webContents.on('before-input-event', (_e, input) => {
        // No devtools in production builds.
        const k = input.key.toLowerCase()
        const devtoolsCombo = (input.control && input.shift && k === 'i') || (input.meta && input.alt && k === 'i')
        if (input.key === 'F12' || devtoolsCombo) _e.preventDefault()
      })
    }
    this.loaded = win.loadURL(pageUrl('editor')).catch((err) => console.error('[editor] failed to load', err))
    this.win = win
  }

  /** Size/center the window on `display`, load the snip, and show it once Excalidraw has it. */
  async open(png: Buffer, pixelSize: { width: number; height: number }, display: Display): Promise<void> {
    if (!this.win || this.win.isDestroyed()) this.create()
    const win = this.win!
    await this.loaded

    const bounds = editorBounds(pixelSize, display)
    if (win.isMaximized()) win.unmaximize()
    placeWindow(win, bounds)
    const [cw, ch] = win.getContentSize()

    const id = ++this.snipCounter
    const snip: EditorSnip = {
      id,
      dataURL: `data:image/png;base64,${png.toString('base64')}`,
      pixelWidth: pixelSize.width,
      pixelHeight: pixelSize.height,
      scaleFactor: display.scaleFactor,
      exportScale: getConfig().exportScale,
      viewport: { width: cw, height: ch }
    }
    const loaded = new Promise<void>((resolve) => (this.waiter = { id, resolve }))
    win.webContents.send(IPC.editorLoad, snip)
    await withTimeout(loaded, 1500, undefined)

    // Briefly topmost so Windows lets us come to the front over whatever had
    // focus (e.g. a borderless-fullscreen game), then back to normal.
    win.setAlwaysOnTop(true)
    win.show()
    if (isMac) app.focus({ steal: true }) // menu-bar apps must activate themselves
    win.focus()
    win.moveTop()
    win.setAlwaysOnTop(false)
    placeWindow(win, bounds)
    win.webContents.send(IPC.editorShown)
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed()) this.win.hide()
  }

  browserWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  isVisible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible()
  }

  allowQuit(): void {
    this.allowClose = true
  }

  destroy(): void {
    this.allowClose = true
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  private async save(req: SaveRequest): Promise<SaveResult> {
    if (!this.win) return { saved: false }
    const dir = snipDrawDir()
    await mkdir(dir, { recursive: true }).catch(() => undefined)
    const png = { name: 'PNG image', extensions: ['png'] }
    const scene = { name: 'Excalidraw scene', extensions: ['excalidraw'] }
    const asScene = req.format === 'excalidraw'
    const { canceled, filePath } = await dialog.showSaveDialog(this.win, {
      title: asScene ? 'Save Excalidraw scene' : 'Save snip',
      defaultPath: join(dir, `${timestampName()}.${asScene ? 'excalidraw' : 'png'}`),
      filters: asScene ? [scene, png] : [png, scene],
      properties: ['showOverwriteConfirmation']
    })
    if (canceled || !filePath) return { saved: false }
    try {
      if (extname(filePath).toLowerCase() === '.excalidraw') {
        await writeFile(filePath, req.scene, 'utf8')
      } else {
        await writeFile(filePath, Buffer.from(req.png))
      }
      return { saved: true, path: filePath }
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private owns(wc: WebContents): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.webContents === wc
  }
}
