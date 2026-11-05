import { app, BrowserWindow, ipcMain, screen, type Display, type WebContents } from 'electron'
import { IPC } from '../shared/ipc'
import type { OverlayImage, OverlaySelection } from '../shared/types'
import type { DisplayCapture } from './capture'
import { isMac, pageUrl, preloadPath } from './paths'
import { placeWindow, withTimeout } from './window-utils'

interface OverlayWindow {
  win: BrowserWindow
  loaded: Promise<void>
}

export interface OverlayHandlers {
  onSelect(sel: OverlaySelection): void
  onCancel(): void
}

/**
 * One frameless, transparent, always-on-top window per display, created ahead
 * of time and kept hidden so a snip only has to push pixels and show them.
 */
export class OverlayManager {
  private readonly windows = new Map<number, OverlayWindow>()
  private readonly waiters = new Map<string, () => void>()

  constructor(private readonly handlers: OverlayHandlers) {}

  init(): void {
    ipcMain.on(IPC.overlayReady, (e, session: number, displayId: number) => {
      if (this.owns(e.sender)) this.resolve(`ready:${session}:${displayId}`)
    })
    ipcMain.on(IPC.overlayResetDone, (e, displayId: number) => {
      if (this.owns(e.sender)) this.resolve(`reset:${displayId}`)
    })
    ipcMain.on(IPC.overlaySelect, (e, sel: OverlaySelection) => {
      if (this.owns(e.sender)) this.handlers.onSelect(sel)
    })
    ipcMain.on(IPC.overlayCancel, (e) => {
      if (this.owns(e.sender)) this.handlers.onCancel()
    })

    this.sync()
    const resync = (): void => this.sync()
    screen.on('display-added', resync)
    screen.on('display-removed', resync)
    screen.on('display-metrics-changed', resync)
  }

  /** Create overlays for new displays, destroy ones whose display went away. */
  sync(): void {
    const displays = screen.getAllDisplays()
    const ids = new Set(displays.map((d) => d.id))
    for (const [id, ow] of this.windows) {
      if (!ids.has(id)) {
        ow.win.destroy()
        this.windows.delete(id)
      }
    }
    for (const d of displays) this.ensure(d)
  }

  private ensure(display: Display): OverlayWindow {
    const existing = this.windows.get(display.id)
    if (existing && !existing.win.isDestroyed()) return existing

    const { x, y, width, height } = display.bounds
    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      roundedCorners: false,
      thickFrame: false,
      // macOS: lets the window cover the menu bar instead of being pushed below it.
      enableLargerThanScreen: true,
      // macOS: the first click on an inactive overlay must start the drag, not
      // just activate the window.
      acceptFirstMouse: true,
      // macOS: an NSPanel can float over other apps' fullscreen Spaces.
      ...(isMac ? { type: 'panel' } : {}),
      title: 'SnipDraw overlay',
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false
      }
    })
    // 'screen-saver' is the highest level: above the taskbar and above
    // borderless-fullscreen games/videos.
    win.setAlwaysOnTop(true, 'screen-saver')
    if (isMac) {
      // Show on whatever Space is active, including fullscreen apps' Spaces,
      // without turning the menu-bar app into a Dock app.
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    } else {
      win.setMenu(null)
    }
    win.on('closed', () => this.windows.delete(display.id))

    const loaded = win.loadURL(pageUrl('overlay')).catch((err) => {
      console.error('[overlay] failed to load', err)
    })
    const ow = { win, loaded }
    this.windows.set(display.id, ow)
    return ow
  }

  /** Push each capture to its overlay, wait until painted, then show them all. */
  async show(session: number, captures: Map<number, DisplayCapture>, focusDisplayId: number): Promise<void> {
    const shown: Array<{ win: BrowserWindow; display: Display; primary: boolean }> = []

    await Promise.all(
      [...captures.values()].map(async ({ display, image }) => {
        const ow = this.ensure(display)
        await ow.loaded
        placeWindow(ow.win, display.bounds)
        const { width, height } = image.getSize()
        const primary = display.id === focusDisplayId
        const msg: OverlayImage = {
          session,
          displayId: display.id,
          bitmap: image.toBitmap(),
          width,
          height,
          primary
        }
        const ready = this.wait(`ready:${session}:${display.id}`)
        ow.win.webContents.send(IPC.overlayImage, msg)
        await withTimeout(ready, 2000, undefined)
        shown.push({ win: ow.win, display, primary })
      })
    )

    // Non-focused displays first, then the one under the cursor gets focus.
    shown.sort((a, b) => Number(a.primary) - Number(b.primary))
    for (const { win, display, primary } of shown) {
      if (win.isDestroyed()) continue
      if (primary) {
        win.show()
        // A menu-bar (accessory) app must activate itself to receive keys like Esc.
        if (isMac) app.focus({ steal: true })
        win.focus()
      } else {
        win.showInactive()
      }
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
      // Re-apply after showing: the DPI-change fix-up only happens once visible.
      placeWindow(win, display.bounds)
    }
  }

  /** Blank every overlay (so the next show can't flash a stale frame), then hide. */
  async hideAll(): Promise<void> {
    await Promise.all(
      [...this.windows.entries()].map(async ([id, { win }]) => {
        if (win.isDestroyed() || !win.isVisible()) return
        const done = this.wait(`reset:${id}`)
        win.webContents.send(IPC.overlayReset)
        await withTimeout(done, 150, undefined)
        if (!win.isDestroyed()) win.hide()
      })
    )
  }

  getWindow(displayId: number): BrowserWindow | undefined {
    return this.windows.get(displayId)?.win
  }

  destroyAll(): void {
    for (const { win } of this.windows.values()) if (!win.isDestroyed()) win.destroy()
    this.windows.clear()
  }

  private owns(wc: WebContents): boolean {
    for (const { win } of this.windows.values()) if (!win.isDestroyed() && win.webContents === wc) return true
    return false
  }

  private wait(key: string): Promise<void> {
    return new Promise((resolve) => this.waiters.set(key, resolve))
  }

  private resolve(key: string): void {
    const r = this.waiters.get(key)
    if (r) {
      this.waiters.delete(key)
      r()
    }
  }
}
