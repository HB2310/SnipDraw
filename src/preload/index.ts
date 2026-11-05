import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { SnipDrawApi } from './api'

/** Subscribe to a main->renderer channel, hiding the IpcRendererEvent from the page. */
function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): void {
  ipcRenderer.on(channel, (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T)))
}

const api: SnipDrawApi = {
  platform: process.platform,
  overlay: {
    onImage: (cb) => on(IPC.overlayImage, cb),
    onReset: (cb) => on(IPC.overlayReset, cb),
    ready: (session, displayId) => ipcRenderer.send(IPC.overlayReady, session, displayId),
    resetDone: (displayId) => ipcRenderer.send(IPC.overlayResetDone, displayId),
    select: (sel) => ipcRenderer.send(IPC.overlaySelect, sel),
    cancel: () => ipcRenderer.send(IPC.overlayCancel)
  },
  editor: {
    onLoad: (cb) => on(IPC.editorLoad, cb),
    onShown: (cb) => on(IPC.editorShown, cb),
    onRequestClose: (cb) => on(IPC.editorRequestClose, cb),
    loaded: (id) => ipcRenderer.send(IPC.editorLoaded, id),
    copy: (png) => ipcRenderer.invoke(IPC.editorCopy, png),
    save: (req) => ipcRenderer.invoke(IPC.editorSave, req),
    hide: () => ipcRenderer.send(IPC.editorHide),
    confirmDiscard: () => ipcRenderer.invoke(IPC.editorConfirmDiscard)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (update) => ipcRenderer.invoke(IPC.settingsSet, update),
    suspendHotkey: (suspend) => ipcRenderer.send(IPC.settingsSuspendHotkey, suspend),
    onChanged: (cb) => on(IPC.settingsChanged, cb)
  }
}

contextBridge.exposeInMainWorld('snipdraw', api)
