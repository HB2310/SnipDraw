import { app, desktopCapturer, dialog, shell, systemPreferences } from 'electron'

const SCREEN_RECORDING_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

/**
 * macOS only shows an app other apps' windows once the user grants Screen
 * Recording permission; until then captures contain just the wallpaper and
 * menu bar. Returns true when snipping can go ahead.
 *
 * The permission is checked on every snip (it's a cheap call) because users
 * can revoke it at any time in System Settings.
 */
export async function ensureScreenCapturePermission(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return true
  // CI machines can't grant the permission; the self-test still exercises the
  // whole pipeline on wallpaper-only captures.
  if (process.env.SNIPDRAW_SELFTEST && !app.isPackaged) return true

  // Asking for sources makes macOS list SnipDraw under Screen Recording (and
  // shows the system prompt the first time), so the user has a switch to flip.
  await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => undefined)

  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'SnipDraw',
    message: 'SnipDraw needs Screen Recording permission',
    detail:
      'macOS only lets SnipDraw capture other apps after you allow it.\n\n' +
      'Open System Settings → Privacy & Security → Screen & System Audio Recording, turn on SnipDraw, ' +
      'then quit and reopen SnipDraw.',
    buttons: ['Open System Settings', 'Quit and Reopen SnipDraw', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  if (response === 0) await shell.openExternal(SCREEN_RECORDING_PANE)
  if (response === 1) {
    app.relaunch()
    app.exit(0)
  }
  return false
}
