import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
  exportToBlob,
  getSceneVersion,
  serializeAsJSON
} from '@excalidraw/excalidraw'
import type { FileId } from '@excalidraw/excalidraw/element/types'
import type {
  AppState,
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
  NormalizedZoomValue
} from '@excalidraw/excalidraw/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DARK_CHROME_CLASS } from '../../../shared/dark-chrome'
import { fitImage, resolveExportScale, sceneImageSize } from '../../../shared/geometry'
import type { EditorSnip, Size } from '../../../shared/types'

const api = window.snipdraw.editor
const isMac = window.snipdraw.platform === 'darwin'
/** Shortcut labels as each platform writes them. */
const KEYS = isMac
  ? { copy: '⌘↩', save: '⌘S', saveScene: '⇧⌘S' }
  : { copy: 'Ctrl+Enter', save: 'Ctrl+S', saveScene: 'Ctrl+Shift+S' }

/** Default annotation color: reads well over most screenshots. */
const ANNOTATION_COLOR = '#e03131'
/** Canvas color around the snip (also the export background where annotations extend past it). */
const CANVAS_BG = '#121212'

export function Editor(): JSX.Element {
  const [excalidraw, setExcalidraw] = useState<ExcalidrawImperativeAPI | null>(null)
  const xRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const snipRef = useRef<EditorSnip | null>(null)
  /** Scene version at load / last copy / last save. Different = unsaved annotations. */
  const cleanVersion = useRef(0)
  /** True until the user zooms/scrolls/draws, so a late resize can re-center. */
  const untouched = useRef(true)
  const busy = useRef(false)
  const pending = useRef<EditorSnip | null>(null)

  const onApi = useCallback((a: ExcalidrawImperativeAPI) => {
    xRef.current = a
    setExcalidraw(a)
  }, [])

  const isDirty = (): boolean => {
    const x = xRef.current
    return !!x && getSceneVersion(x.getSceneElementsIncludingDeleted()) !== cleanVersion.current
  }
  const markClean = (): void => {
    const x = xRef.current
    if (x) cleanVersion.current = getSceneVersion(x.getSceneElementsIncludingDeleted())
  }

  const center = useCallback((vp: Size): View | null => {
    const x = xRef.current
    const snip = snipRef.current
    if (!x || !snip) return null
    const img = sceneImageSize({ width: snip.pixelWidth, height: snip.pixelHeight }, snip.scaleFactor)
    const view = fitImage(img, vp, window.devicePixelRatio)
    x.updateScene({
      appState: { zoom: { value: view.zoom as NormalizedZoomValue }, scrollX: view.scrollX, scrollY: view.scrollY },
      captureUpdate: CaptureUpdateAction.NEVER
    })
    return view
  }, [])

  const load = useCallback(
    async (snip: EditorSnip) => {
      const x = xRef.current
      if (!x) {
        pending.current = snip // Excalidraw not mounted yet; load once it is.
        return
      }
      snipRef.current = snip
      untouched.current = true

      // Main resized the (hidden) window just before sending; wait for the
      // viewport to catch up so centering uses the right size.
      if (window.innerWidth !== snip.viewport.width || window.innerHeight !== snip.viewport.height) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 200)
          window.addEventListener('resize', () => (clearTimeout(t), resolve()), { once: true })
        })
      }

      const fileId = `snip-${snip.id}-${Date.now()}` as FileId
      const file: BinaryFileData = {
        id: fileId,
        dataURL: snip.dataURL as DataURL,
        mimeType: 'image/png',
        created: Date.now()
      }
      const size = sceneImageSize({ width: snip.pixelWidth, height: snip.pixelHeight }, snip.scaleFactor)
      const elements = convertToExcalidrawElements([
        { type: 'image', fileId, x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height }
      ])

      // Start decoding our own copy now; it doubles as the reference for
      // checking that Excalidraw has actually painted the snip.
      const reference = decodeReference(snip.dataURL)

      x.resetScene()
      // Element first, then file: addFiles() only starts decoding images for
      // elements already in the scene. The other order leaves the snip as a
      // grey placeholder until a throttled 500ms failsafe refresh.
      x.updateScene({
        elements,
        appState: {
          currentItemStrokeColor: ANNOTATION_COLOR,
          selectedElementIds: {},
          openDialog: null,
          openMenu: null,
          openPopup: null,
          viewBackgroundColor: CANVAS_BG
        },
        captureUpdate: CaptureUpdateAction.NEVER
      })
      x.addFiles([file])
      x.history.clear()
      x.setActiveTool({ type: 'selection' })
      const view = center({ width: window.innerWidth, height: window.innerHeight })
      markClean()
      // Only tell main to show the window once the real pixels are on the
      // canvas (capped, so a slow decode can't stall the editor).
      if (view) await waitForSnipPainted(await reference, size, view, 700)
      api.loaded(snip.id)
    },
    [center]
  )

  const exportPng = useCallback(async (): Promise<Uint8Array> => {
    const x = xRef.current!
    const snip = snipRef.current
    const scale = resolveExportScale(snip?.exportScale ?? 2, snip?.scaleFactor ?? 1)
    const blob = await exportToBlob({
      elements: x.getSceneElements(),
      files: x.getFiles(),
      appState: {
        ...x.getAppState(),
        exportBackground: true,
        // Same unfiltered rendering as the editor canvas (see shared/dark-chrome.ts),
        // so the screenshot pixels and annotation colors come out exactly as shown.
        exportWithDarkMode: false
      },
      exportPadding: 0,
      mimeType: 'image/png',
      getDimensions: (w: number, h: number) => ({ width: Math.round(w * scale), height: Math.round(h * scale), scale })
    })
    return new Uint8Array(await blob.arrayBuffer())
  }, [])

  const copy = useCallback(async () => {
    if (busy.current || !xRef.current || !snipRef.current) return
    busy.current = true
    try {
      const ok = await api.copy(await exportPng())
      if (ok) markClean()
      else xRef.current.setToast({ message: 'Could not copy the image to the clipboard.', closable: true })
    } catch (err) {
      xRef.current?.setToast({ message: `Copy failed: ${String(err)}`, closable: true })
    } finally {
      busy.current = false
    }
  }, [exportPng])

  const save = useCallback(
    async (format: 'png' | 'excalidraw') => {
      const x = xRef.current
      if (busy.current || !x || !snipRef.current) return
      busy.current = true
      try {
        const scene = serializeAsJSON(x.getSceneElements(), x.getAppState(), x.getFiles(), 'local')
        const res = await api.save({ format, png: await exportPng(), scene })
        if (res.saved) {
          markClean()
          x.setToast({ message: `Saved to ${res.path}`, duration: 3000 })
        } else if (res.error) {
          x.setToast({ message: `Save failed: ${res.error}`, closable: true })
        }
      } finally {
        busy.current = false
      }
    },
    [exportPng]
  )

  const close = useCallback(async () => {
    if (isDirty() && !(await api.confirmDiscard())) return
    api.hide()
  }, [])

  // Wire main-process events once.
  useEffect(() => {
    api.onLoad((snip) => void load(snip))
    api.onShown(() => {
      if (untouched.current) center({ width: window.innerWidth, height: window.innerHeight })
    })
    api.onRequestClose(() => void close())
  }, [load, center, close])

  // A snip may arrive before Excalidraw hands us its API.
  useEffect(() => {
    if (excalidraw && pending.current) {
      const s = pending.current
      pending.current = null
      void load(s)
    }
  }, [excalidraw, load])

  // Shortcuts. Capture phase so we run before Excalidraw's own handlers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        void copy()
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        void save(e.shiftKey ? 'excalidraw' : 'png')
      } else if (e.key === 'Escape' && !e.repeat && canEscapeClose(e, xRef.current?.getAppState())) {
        e.preventDefault()
        e.stopPropagation()
        void close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [copy, save, close])

  return (
    <div className={`editor-root ${DARK_CHROME_CLASS}`}>
      <Excalidraw
        excalidrawAPI={onApi}
        // Light mode = no canvas filters, so the snip shows its true pixels;
        // the dark look comes from DARK_CHROME_CLASS (see shared/dark-chrome.ts).
        theme="light"
        autoFocus
        handleKeyboardGlobally
        aiEnabled={false}
        onPointerDown={() => (untouched.current = false)}
        initialData={{ appState: { theme: 'light', viewBackgroundColor: CANVAS_BG, currentItemStrokeColor: ANNOTATION_COLOR } }}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: true,
            clearCanvas: false,
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: false,
            toggleTheme: false
          },
          tools: { image: true }
        }}
        renderTopRightUI={() => (
          <div className="sd-actions">
            <button className="sd-btn sd-btn--primary" onClick={() => void copy()} title={`Copy to clipboard (${KEYS.copy})`}>
              Copy
            </button>
            <button className="sd-btn" onClick={() => void save('png')} title={`Save as PNG (${KEYS.save})`}>
              Save
            </button>
          </div>
        )}
      >
        <MainMenu>
          <MainMenu.Item onSelect={() => void copy()} shortcut={KEYS.copy}>
            Copy to clipboard
          </MainMenu.Item>
          <MainMenu.Item onSelect={() => void save('png')} shortcut={KEYS.save}>
            Save as PNG…
          </MainMenu.Item>
          <MainMenu.Item onSelect={() => void save('excalidraw')} shortcut={KEYS.saveScene}>
            Save as .excalidraw…
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
    </div>
  )
}

/**
 * Esc closes the editor only when Excalidraw isn't using it: not while typing,
 * drawing a multi-point line, with a selection, or with a menu/dialog open.
 */
function canEscapeClose(e: KeyboardEvent, s: AppState | undefined): boolean {
  if (!s) return true
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return false
  if (s.editingTextElement || s.newElement || s.multiElement || s.selectionElement) return false
  if (s.openDialog || s.openMenu || s.openPopup || s.openSidebar || s.contextMenu) return false
  if (Object.keys(s.selectedElementIds).length > 0) return false
  return true
}

type View = { zoom: number; scrollX: number; scrollY: number }

interface Reference {
  width: number
  height: number
  /** RGB at a few sample points (fractions of the image). */
  samples: Array<{ fx: number; fy: number; rgb: [number, number, number] }>
}

const SAMPLE_POINTS: Array<[number, number]> = [
  [0.21, 0.27],
  [0.5, 0.5],
  [0.77, 0.71]
]

async function decodeReference(dataURL: string): Promise<Reference | null> {
  try {
    const img = new Image()
    img.src = dataURL
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    return {
      width: c.width,
      height: c.height,
      samples: SAMPLE_POINTS.map(([fx, fy]) => {
        const d = ctx.getImageData(Math.floor(fx * c.width), Math.floor(fy * c.height), 1, 1).data
        return { fx, fy, rgb: [d[0], d[1], d[2]] as [number, number, number] }
      })
    }
  } catch {
    return null
  }
}

/**
 * Poll Excalidraw's static canvas until the snip's pixels are there (rather
 * than its grey "image loading" placeholder), or until `timeoutMs`. Exact at
 * 100% zoom; when zoomed out the sampled pixel is a blend, hence the tolerance.
 */
async function waitForSnipPainted(ref: Reference | null, img: Size, view: View, timeoutMs: number): Promise<boolean> {
  if (!ref) return false
  const tolerance = view.zoom === 1 ? 6 : 60
  const dpr = window.devicePixelRatio
  const t0 = performance.now()
  while (performance.now() - t0 < timeoutMs) {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.excalidraw__canvas:not(.interactive)')
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) {
      const painted = ref.samples.every(({ fx, fy, rgb }) => {
        // centre of the sampled source pixel, in scene coordinates
        const sx = -img.width / 2 + ((Math.floor(fx * ref.width) + 0.5) / ref.width) * img.width
        const sy = -img.height / 2 + ((Math.floor(fy * ref.height) + 0.5) / ref.height) * img.height
        const px = Math.floor((sx + view.scrollX) * view.zoom * dpr)
        const py = Math.floor((sy + view.scrollY) * view.zoom * dpr)
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return true
        const d = ctx.getImageData(px, py, 1, 1).data
        return Math.abs(d[0] - rgb[0]) + Math.abs(d[1] - rgb[1]) + Math.abs(d[2] - rgb[2]) <= tolerance * 3
      })
      if (painted) return true
    }
    await new Promise((r) => setTimeout(r, 16))
  }
  return false
}
