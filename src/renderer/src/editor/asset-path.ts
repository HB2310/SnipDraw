// Imported before @excalidraw/excalidraw so its fonts resolve against our own
// origin (fonts are copied into the renderer's public dir) instead of a CDN.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

window.EXCALIDRAW_ASSET_PATH = new URL('./', window.location.href).href

export {}
