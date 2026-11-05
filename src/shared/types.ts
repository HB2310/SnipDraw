/** Types shared by main, preload and renderer. Keep this file free of runtime imports. */

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 'native' = export so the screenshot pixels map 1:1 to output pixels. */
export type ExportScale = 'native' | 1 | 2 | 3

export interface AppConfig {
  /** Electron accelerator string, e.g. "Super+Shift+E". */
  hotkey: string
  /** Save every raw snip to Pictures\SnipDraw\history. */
  autoSaveHistory: boolean
  exportScale: ExportScale
}

export interface SettingsState {
  config: AppConfig
  /** Whether the app is registered to start at login. */
  startWithWindows: boolean
  /** Launch-at-login only makes sense for the installed build. */
  canStartWithWindows: boolean
  /** Whether the current hotkey is registered with the OS right now. */
  hotkeyRegistered: boolean
}

export type SettingsUpdate = Partial<AppConfig> & { startWithWindows?: boolean }

export type SettingsResult =
  | { ok: true; state: SettingsState }
  | { ok: false; error: string; state: SettingsState }

/** Sent main -> overlay renderer with the frozen capture for its display. */
export interface OverlayImage {
  /** Monotonic id so stale acks/selections from a previous snip are ignored. */
  session: number
  displayId: number
  /** Raw pixels from nativeImage.toBitmap() (BGRA on Windows). */
  bitmap: Uint8Array
  width: number
  height: number
  /** Show the "drag to snip" hint on this display (the one under the cursor). */
  primary: boolean
}

/** Sent overlay -> main when the user finishes a drag (or clicks). */
export interface OverlaySelection {
  session: number
  displayId: number
  /** Selection in overlay viewport CSS pixels. width/height 0 = whole display. */
  rect: Rect
  /** window.innerWidth/innerHeight of the overlay when the selection was made. */
  viewport: Size
}

/** Sent main -> editor renderer to load a new snip. */
export interface EditorSnip {
  id: number
  /** PNG data URL of the cropped snip at native resolution. */
  dataURL: string
  /** Native pixel size of the snip. */
  pixelWidth: number
  pixelHeight: number
  /** scaleFactor of the display the snip was taken on. */
  scaleFactor: number
  exportScale: ExportScale
  /** Content size the editor window was just given (CSS px). */
  viewport: Size
}

export interface SaveRequest {
  /** Which format the user asked for; the extension they type in the dialog still wins. */
  format: 'png' | 'excalidraw'
  png: Uint8Array
  /** Serialized .excalidraw scene. */
  scene: string
}

export type SaveResult = { saved: true; path: string } | { saved: false; error?: string }
