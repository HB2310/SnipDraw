import type {
  EditorSnip,
  OverlayImage,
  OverlaySelection,
  SaveRequest,
  SaveResult,
  SettingsResult,
  SettingsState,
  SettingsUpdate
} from '../shared/types'

/** Shape of `window.snipdraw`, exposed by the preload via contextBridge. */
export interface SnipDrawApi {
  /** process.platform of the app ("win32", "darwin", ...). */
  platform: string
  overlay: {
    onImage(cb: (img: OverlayImage) => void): void
    onReset(cb: () => void): void
    ready(session: number, displayId: number): void
    resetDone(displayId: number): void
    select(sel: OverlaySelection): void
    cancel(): void
  }
  editor: {
    onLoad(cb: (snip: EditorSnip) => void): void
    onShown(cb: () => void): void
    onRequestClose(cb: () => void): void
    loaded(id: number): void
    copy(png: Uint8Array): Promise<boolean>
    save(req: SaveRequest): Promise<SaveResult>
    hide(): void
    confirmDiscard(): Promise<boolean>
  }
  settings: {
    get(): Promise<SettingsState>
    set(update: SettingsUpdate): Promise<SettingsResult>
    suspendHotkey(suspend: boolean): void
    onChanged(cb: (state: SettingsState) => void): void
  }
}

declare global {
  interface Window {
    snipdraw: SnipDrawApi
  }
}
