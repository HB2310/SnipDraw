/** IPC channel names. One place so main and preload can't drift apart. */
export const IPC = {
  // main -> overlay
  overlayImage: 'overlay:image',
  overlayReset: 'overlay:reset',
  // overlay -> main
  overlayReady: 'overlay:ready',
  overlayResetDone: 'overlay:reset-done',
  overlaySelect: 'overlay:select',
  overlayCancel: 'overlay:cancel',

  // main -> editor
  editorLoad: 'editor:load',
  editorShown: 'editor:shown',
  editorRequestClose: 'editor:request-close',
  // editor -> main
  editorLoaded: 'editor:loaded',
  editorCopy: 'editor:copy',
  editorSave: 'editor:save',
  editorHide: 'editor:hide',
  editorConfirmDiscard: 'editor:confirm-discard',

  // settings <-> main
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsSuspendHotkey: 'settings:suspend-hotkey',
  settingsChanged: 'settings:changed'
} as const
