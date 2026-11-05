import { app, net, protocol, session, shell } from 'electron'
import { normalize, relative, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_HOST, APP_SCHEME, rendererDir } from './paths'

/** URLs refused by lockDownNetwork (inspected by the dev self-test). */
export const blockedRequests: string[] = []

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

/**
 * Serve the built renderer from app://snipdraw/. A real origin (instead of
 * file://) lets Excalidraw resolve and fetch its bundled fonts normally.
 */
export function serveRenderer(): void {
  const root = rendererDir()
  protocol.handle(APP_SCHEME, (req) => {
    const url = new URL(req.url)
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 })
    const file = normalize(join(root, decodeURIComponent(url.pathname)))
    const rel = relative(root, file)
    if (rel.startsWith('..') || isAbsolute(rel)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

/**
 * The app needs no network at runtime: block every http(s)/ws request except
 * the Vite dev server in development. Links the user clicks (e.g. in
 * Excalidraw's help dialog) open in the default browser instead.
 */
export function lockDownNetwork(): void {
  const devOrigin = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL) : null
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const u = new URL(details.url)
      const allowed = devOrigin !== null && u.hostname === devOrigin.hostname && u.port === devOrigin.port
      if (!allowed) {
        blockedRequests.push(details.url)
        console.warn(`[net] blocked ${details.url}`)
      }
      callback({ cancel: !allowed })
    }
  )
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    // Clipboard writes are done by the main process; nothing else is needed.
    cb(permission === 'clipboard-sanitized-write')
  })

  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (e, url) => {
      const current = contents.getURL()
      if (url !== current) {
        e.preventDefault()
        if (/^https?:\/\//.test(url) && !(devOrigin && url.startsWith(devOrigin.origin))) void shell.openExternal(url)
      }
    })
  })
}
