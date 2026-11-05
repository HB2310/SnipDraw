import { app } from 'electron'
import { join } from 'node:path'

export function snipDrawDir(): string {
  return join(app.getPath('pictures'), 'SnipDraw')
}

export function historyDir(): string {
  return join(snipDrawDir(), 'history')
}

/** snip-YYYYMMDD-HHmmss (local time). */
export function timestampName(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `snip-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** Files shipped in /resources (icon). Packaged: copied next to app.asar via extraResources. */
export function resourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources', name) : join(app.getAppPath(), 'resources', name)
}

export function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

export const APP_SCHEME = 'app'
export const APP_HOST = 'snipdraw'

/** URL for a renderer page: Vite dev server in dev, custom app:// protocol when built. */
export function pageUrl(page: 'overlay' | 'editor' | 'settings'): string {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && dev) return `${dev}/${page}.html`
  return `${APP_SCHEME}://${APP_HOST}/${page}.html`
}

export function rendererDir(): string {
  return join(__dirname, '../renderer')
}

export const isMac = process.platform === 'darwin'

/** Window/taskbar icon. macOS takes the app icon from the bundle and ignores this. */
export function windowIconPath(): string {
  return resourcePath(isMac ? 'icon.png' : 'icon.ico')
}
