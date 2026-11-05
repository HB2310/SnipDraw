import { app, BrowserWindow } from 'electron'
import { isMac, pageUrl, preloadPath, windowIconPath } from './paths'

let win: BrowserWindow | null = null

export function openSettings(): void {
  if (isMac) app.focus({ steal: true }) // menu-bar apps must activate themselves
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }
  win = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    maximizable: false,
    minimizable: false,
    title: 'SnipDraw Settings',
    icon: windowIconPath(),
    backgroundColor: '#1e1e1e',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  if (!isMac) win.setMenu(null)
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  void win.loadURL(pageUrl('settings'))
}

export function settingsWebContents(): Electron.WebContents | null {
  return win && !win.isDestroyed() ? win.webContents : null
}

export function closeSettings(): void {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}
