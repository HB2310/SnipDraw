import { Menu, Notification, Tray } from 'electron'
import { formatAccelerator } from '../shared/accelerator'
import { isMac, resourcePath } from './paths'

export interface TrayActions {
  snip(): void
  settings(): void
  setStartWithWindows(on: boolean): void
  quit(): void
  state(): { hotkey: string | null; startWithWindows: boolean; canStartWithWindows: boolean }
}

/**
 * Windows: notification-area icon; left-click snips, right-click opens the menu.
 * macOS: menu-bar icon (a "Template" image, so macOS tints it for light/dark
 * menu bars); clicking opens the menu, as menu-bar apps do.
 */
export class AppTray {
  private readonly tray: Tray

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(resourcePath(isMac ? 'trayTemplate.png' : 'icon.ico'))
    if (!isMac) this.tray.on('click', () => this.actions.snip())
    this.refresh()
  }

  refresh(): void {
    const s = this.actions.state()
    const hotkey = s.hotkey ? formatAccelerator(s.hotkey, process.platform) : null
    this.tray.setToolTip(hotkey ? `SnipDraw (${hotkey})` : 'SnipDraw (no hotkey)')
    const loginLabel = isMac ? 'Open at Login' : 'Start with Windows'
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          // The hotkey is shown right-aligned (a tab on Windows, a menu
          // accelerator on macOS) but not registered here: the global hotkey does that.
          label: !isMac && hotkey ? `Snip now\t${hotkey}` : 'Snip now',
          accelerator: isMac && s.hotkey ? s.hotkey : undefined,
          registerAccelerator: false,
          click: () => this.actions.snip()
        },
        { label: 'Settings…', click: () => this.actions.settings() },
        {
          label: s.canStartWithWindows ? loginLabel : `${loginLabel} (installed app only)`,
          type: 'checkbox',
          checked: s.startWithWindows,
          enabled: s.canStartWithWindows,
          click: (item) => this.actions.setStartWithWindows(item.checked)
        },
        { type: 'separator' },
        { label: 'Quit SnipDraw', click: () => this.actions.quit() }
      ])
    )
  }

  notify(title: string, content: string, warning = true): void {
    if (isMac) {
      if (Notification.isSupported()) new Notification({ title, body: content, silent: !warning }).show()
      return
    }
    this.tray.displayBalloon({ title, content, iconType: warning ? 'warning' : 'info' })
  }

  destroy(): void {
    this.tray.destroy()
  }
}
