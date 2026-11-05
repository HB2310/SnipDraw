# Contributing to SnipDraw

Thanks for helping! Bug reports, fixes and small features are all welcome.

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts Vite plus Electron with hot reload. The app lives in the system tray (Windows) or menu bar
(macOS). A dev build keeps its settings separate from an installed SnipDraw, so both can run at once. Only one of
them can own the global hotkey, though.

## Before you open a pull request

```bash
npm run typecheck
npm test
```

If you touched capture, the overlay or the editor, please also run the end-to-end self-test on your machine. It
drives the real app on every connected monitor and checks the pixels (see "Tests" in the README). Mention your
monitor setup (resolutions and scaling) in the PR, since multi-monitor and mixed-DPI bugs depend on it.

## Project layout

- `src/main`: Electron main process (hotkey, capture, windows, IPC).
- `src/preload`: the `contextBridge` API. Renderers have no Node access.
- `src/renderer`: three pages: overlay, editor and settings.
- `src/shared`: pure, unit-tested logic. If you change coordinate math, add a test in `geometry.test.ts`.

## Guidelines

- Keep the app offline: no network requests at runtime (the self-test checks this).
- Keep `contextIsolation` on, `nodeIntegration` off and renderers sandboxed.
- Platform-specific code is fine, but keep it behind `process.platform` checks and say what you tested on.

By contributing you agree that your contributions are licensed under the MIT License.
