import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { dragToRect, viewportRectToPixels } from '../../../shared/geometry'
import { bgraToRgba } from '../../../shared/pixels'

interface Frame {
  session: number
  displayId: number
  width: number
  height: number
  primary: boolean
}

interface Drag {
  x0: number
  y0: number
  x1: number
  y1: number
}

const api = window.snipdraw.overlay

export function Overlay(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [done, setDone] = useState(false)
  const frameRef = useRef<Frame | null>(null)
  frameRef.current = frame

  useEffect(() => {
    api.onImage((img) => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d', { alpha: false })
      if (ctx) {
        const data = ctx.createImageData(img.width, img.height)
        bgraToRgba(img.bitmap, img.width, img.height, data.data)
        ctx.putImageData(data, 0, 0)
      }
      // Commit synchronously: main shows the window as soon as we ack, and the
      // first frame must already have the dim layer.
      flushSync(() => {
        setDrag(null)
        setDone(false)
        setFrame({
          session: img.session,
          displayId: img.displayId,
          width: img.width,
          height: img.height,
          primary: img.primary
        })
      })
      api.ready(img.session, img.displayId)
    })

    api.onReset(() => {
      const id = frameRef.current?.displayId
      const canvas = canvasRef.current
      if (canvas) {
        // Shrinking the canvas frees the full-res buffer and blanks the window.
        canvas.width = 1
        canvas.height = 1
      }
      flushSync(() => {
        setFrame(null)
        setDrag(null)
        setDone(false)
      })
      // Give the compositor a frame to present the blank state before main hides us.
      requestAnimationFrame(() => api.resetDone(id ?? -1))
    })

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') api.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /**
   * The capture's area in CSS px. It is drawn 1 bitmap px per device px from
   * the window origin, which Chromium maps exactly onto the display's physical
   * origin, so selection px = CSS px * devicePixelRatio. At fractional DPI
   * Windows may size the window a pixel or two larger than the display; that
   * excess hangs off-screen and selections are clamped to the image.
   */
  const imageArea = (f: Frame): { width: number; height: number } => ({
    width: f.width / window.devicePixelRatio,
    height: f.height / window.devicePixelRatio
  })

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!frame || done) return
      if (e.button === 2) {
        api.cancel()
        return
      }
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY })
    },
    [frame, done]
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!drag || done) return
      setDrag({ ...drag, x1: e.clientX, y1: e.clientY })
    },
    [drag, done]
  )

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!frame || !drag || done || e.button !== 0) return
      const vp = imageArea(frame)
      const rect = dragToRect(drag.x0, drag.y0, e.clientX, e.clientY, vp)
      setDrag({ ...drag, x1: e.clientX, y1: e.clientY })
      setDone(true)
      api.select({ session: frame.session, displayId: frame.displayId, rect, viewport: vp })
    },
    [frame, drag, done]
  )

  const vp = frame ? imageArea(frame) : { width: window.innerWidth, height: window.innerHeight }
  const rect = drag ? dragToRect(drag.x0, drag.y0, drag.x1, drag.y1, vp) : null
  const px = rect && frame ? viewportRectToPixels(rect, vp, frame) : null
  const hasSelection = !!rect && rect.width > 0 && rect.height > 0

  return (
    <div
      className="overlay-root"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        className="capture"
        style={frame ? { width: frame.width / window.devicePixelRatio, height: frame.height / window.devicePixelRatio } : undefined}
      />
      {frame && !hasSelection && <div className="dim" />}
      {frame && hasSelection && rect && (
        <>
          {/* Four dim bands around the selection. (A huge box-shadow "hole" is
              not painted reliably by Chromium on very large displays.) */}
          <div className="dim" style={{ left: 0, top: 0, width: '100%', height: rect.y }} />
          <div className="dim" style={{ left: 0, top: rect.y + rect.height, width: '100%', bottom: 0, height: 'auto' }} />
          <div className="dim" style={{ left: 0, top: rect.y, width: rect.x, height: rect.height }} />
          <div
            className="dim"
            style={{ left: rect.x + rect.width, top: rect.y, right: 0, width: 'auto', height: rect.height }}
          />
          <div className="selection" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />
          {px && (
            <div
              className="size-label"
              style={{
                left: Math.min(rect.x, vp.width - 120),
                top: rect.y >= 28 ? rect.y - 26 : rect.y + rect.height + 6 > vp.height - 24 ? rect.y + 4 : rect.y + rect.height + 6
              }}
            >
              {px.width} × {px.height} px
            </div>
          )}
        </>
      )}
      {frame?.primary && !drag && (
        <div className="hint">Drag to snip · Click for the whole screen · Esc or right-click to cancel</div>
      )}
    </div>
  )
}
