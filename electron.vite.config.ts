import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Strict CSP for the packaged app. Only injected at build time because Vite's
 * dev server needs inline scripts (React refresh preamble) and a websocket.
 */
function productionCsp(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
  return {
    name: 'snipdraw-production-csp',
    apply: 'build',
    transformIndexHtml: (html: string) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`)
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // Excalidraw fonts are copied here by scripts/copy-fonts.mjs so they are
    // served locally (Excalidraw would otherwise fall back to a CDN).
    publicDir: resolve(__dirname, 'src/renderer/public'),
    plugins: [react(), productionCsp()],
    define: {
      // Required by @excalidraw/excalidraw when bundled with Vite.
      'process.env.IS_PREACT': JSON.stringify('false')
    },
    build: {
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          editor: resolve(__dirname, 'src/renderer/editor.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html')
        }
      }
    }
  }
})
