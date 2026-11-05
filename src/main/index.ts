import { app, ipcMain, Menu } from 'electron'
import { join } from 'node:path'
import { formatAccelerator } from '../shared/accelerator'
import { IPC } from '../shared/ipc'
import type { SettingsResult, SettingsState, SettingsUpdate } from '../shared/types'
import { getConfig, loadConfig, saveConfig } from './config'
import { EditorWindow } from './editor'
import { Hotkey } from './hotkey'
import { OverlayManager } from './overlay'
import { registerAppScheme, lockDownNetwork, serveRenderer } from './security'
import { closeSettings, openSettings, settingsWebContents } from './settings-window'
import { SnipController } from './snip'
import { isMac } from './paths'
import { AppTray } from './tray'

const APP_ID = 'com.snipdraw.app'

// Dev/preview builds get their own settings folder (and therefore their own
// single-instance lock), so they run alongside an installed SnipDraw.
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'SnipDraw-dev'))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerAppScheme()
  if (isMac) {
    // Menu-bar app: no Dock icon (the packaged app also sets LSUIElement).
    app.dock?.hide()
    // macOS routes ⌘C/⌘V/⌘Z/⌘A through the app menu's Edit roles; without them
    // copy/paste/undo stop working in text fields.
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]))
  } else {
    app.setAppUserModelId(APP_ID)
    Menu.setApplicationMenu(null)
  }

  let tray: AppTray | null = null

  const editor = new EditorWindow()
  const overlays = new OverlayManager({
    onSelect: (sel) => void snips.select(sel),
    onCancel: () => snips.cancel()
  })
  const snips = new SnipController(overlays, editor, (title, msg) => tray?.notify(title, msg))
  const hotkey = new Hotkey(() => void snips.start())

  const canStartWithWindows = (): boolean => app.isPackaged
  const startWithWindows = (): boolean => canStartWithWindows() && app.getLoginItemSettings().openAtLogin
  const setStartWithWindows = (on: boolean): void => {
    if (!canStartWithWindows()) return
    app.setLoginItemSettings(isMac ? { openAtLogin: on } : { openAtLogin: on, path: process.execPath })
    tray?.refresh()
    broadcastSettings()
  }

  const settingsState = (): SettingsState => ({
    config: getConfig(),
    startWithWindows: startWithWindows(),
    canStartWithWindows: canStartWithWindows(),
    hotkeyRegistered: hotkey.isRegistered && hotkey.current === getConfig().hotkey
  })

  const broadcastSettings = (): void => {
    settingsWebContents()?.send(IPC.settingsChanged, settingsState())
  }

  const applyHotkey = (accelerator: string): string | null => {
    const err = hotkey.set(accelerator)
    tray?.refresh()
    return err
  }

  app.on('second-instance', () => openSettings())
  // macOS: opening the app again from Finder/Launchpad while it runs.
  app.on('activate', (_e, hasVisibleWindows) => {
    if (!hasVisibleWindows) openSettings()
  })
  // Tray app: closing windows must not quit.
  app.on('window-all-closed', () => undefined)
  // Let the editor window actually close (it normally hides on close).
  app.on('before-quit', () => editor.allowQuit())
  app.on('will-quit', () => {
    editor.destroy()
    overlays.destroyAll()
    tray?.destroy()
  })

  void app.whenReady().then(() => {
    loadConfig()
    lockDownNetwork()
    serveRenderer()

    ipcMain.handle(IPC.settingsGet, () => settingsState())
    ipcMain.handle(IPC.settingsSet, (_e, update: SettingsUpdate): SettingsResult => {
      const cfg = { ...getConfig() }
      if (update.hotkey !== undefined && update.hotkey !== cfg.hotkey) {
        const err = applyHotkey(update.hotkey)
        if (err) return { ok: false, error: err, state: settingsState() }
        cfg.hotkey = update.hotkey
      }
      if (update.autoSaveHistory !== undefined) cfg.autoSaveHistory = update.autoSaveHistory
      if (update.exportScale !== undefined) cfg.exportScale = update.exportScale
      saveConfig(cfg)
      if (update.startWithWindows !== undefined) setStartWithWindows(update.startWithWindows)
      tray?.refresh()
      broadcastSettings()
      return { ok: true, state: settingsState() }
    })
    ipcMain.on(IPC.settingsSuspendHotkey, (_e, suspend: boolean) => {
      if (suspend) hotkey.suspend()
      else hotkey.resume()
    })

    tray = new AppTray({
      snip: () => void snips.start(),
      settings: () => openSettings(),
      setStartWithWindows,
      quit: () => {
        closeSettings()
        app.quit()
      },
      state: () => ({
        hotkey: hotkey.isRegistered ? hotkey.current : null,
        startWithWindows: startWithWindows(),
        canStartWithWindows: canStartWithWindows()
      })
    })

    overlays.init()
    editor.init()

    const err = applyHotkey(getConfig().hotkey)
    if (err) {
      tray.notify(
        'SnipDraw hotkey unavailable',
        `${formatAccelerator(getConfig().hotkey, process.platform)} could not be registered. Use the ${isMac ? 'menu-bar' : 'tray'} icon to snip, or pick another shortcut in Settings.`
      )
    }

    if (process.env.SNIPDRAW_SELFTEST && !app.isPackaged) {
      void import('./selftest').then((m) => m.runSelfTest({ snips, overlays, editor, hotkeyError: err }))
    }
  })
}
