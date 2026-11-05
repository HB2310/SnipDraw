import { useEffect, useState } from 'react'
import { eventToAccelerator, formatAccelerator } from '../../../shared/accelerator'
import type { ExportScale, SettingsState, SettingsUpdate } from '../../../shared/types'

const api = window.snipdraw.settings
const platform = window.snipdraw.platform
const isMac = platform === 'darwin'
const fmt = (acc: string): string => formatAccelerator(acc, platform)

const SCALES: Array<{ value: ExportScale; label: string }> = [
  { value: 'native', label: 'Match screenshot (1 image px = 1 output px)' },
  { value: 1, label: '1x' },
  { value: 2, label: '2x (default)' },
  { value: 3, label: '3x' }
]

export function Settings(): JSX.Element {
  const [state, setState] = useState<SettingsState | null>(null)
  const [recording, setRecording] = useState(false)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    void api.get().then((s) => {
      setState(s)
      setDraft(s.config.hotkey)
    })
    api.onChanged(setState)
  }, [])

  const apply = async (update: SettingsUpdate, okText?: string): Promise<boolean> => {
    const res = await api.set(update)
    setState(res.state)
    if (!res.ok) {
      setMessage({ kind: 'error', text: res.error })
      return false
    }
    if (okText) setMessage({ kind: 'ok', text: okText })
    return true
  }

  // While recording, capture the next key combo instead of letting it act.
  useEffect(() => {
    if (!recording) return
    api.suspendHotkey(true)
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setRecording(false)
        return
      }
      const acc = eventToAccelerator(e, platform)
      if (acc) {
        setDraft(acc)
        setRecording(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      api.suspendHotkey(false)
    }
  }, [recording])

  if (!state) return <div className="settings">Loading…</div>
  const { config } = state
  const hotkeyChanged = draft.trim() !== '' && draft.trim() !== config.hotkey

  return (
    <div className="settings">
      <h1>SnipDraw settings</h1>

      <section>
        <h2>Snip hotkey</h2>
        <p className="muted">
          Current: <kbd>{fmt(config.hotkey)}</kbd>{' '}
          {state.hotkeyRegistered ? (
            <span className="ok">active</span>
          ) : (
            <span className="error">not registered</span>
          )}
        </p>
        <div className="row">
          <input
            className="hotkey-input"
            value={recording ? 'Press a key combination… (Esc to stop)' : draft}
            readOnly={recording}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Hotkey (Electron accelerator)"
          />
          <button onClick={() => setRecording((r) => !r)}>{recording ? 'Stop' : 'Record'}</button>
          <button
            className="primary"
            disabled={!hotkeyChanged || recording}
            onClick={() => void apply({ hotkey: draft.trim() }, `Hotkey set to ${fmt(draft.trim())}.`)}
          >
            Apply
          </button>
        </div>
        <p className="hint">
          Shown as {draft ? <kbd>{fmt(draft)}</kbd> : '—'}. You can also type an Electron accelerator,
          e.g.{' '}
          {isMac ? (
            <>
              <code>Command+Shift+E</code>, <code>Ctrl+Alt+S</code>, <code>F13</code>.
            </>
          ) : (
            <>
              <code>Super+Shift+E</code>, <code>Ctrl+Alt+S</code>, <code>PrintScreen</code>.
            </>
          )}
        </p>
      </section>

      <section>
        <h2>General</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={state.startWithWindows}
            disabled={!state.canStartWithWindows}
            onChange={(e) => void apply({ startWithWindows: e.target.checked })}
          />
          {isMac ? 'Open at login' : 'Start with Windows'}
          {!state.canStartWithWindows && <span className="muted"> (installed app only)</span>}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={config.autoSaveHistory}
            onChange={(e) => void apply({ autoSaveHistory: e.target.checked })}
          />
          Auto-save every snip to {isMac ? '~/Pictures/SnipDraw/history' : 'Pictures\\SnipDraw\\history'}
        </label>
      </section>

      <section>
        <h2>Copy / Save PNG size</h2>
        <select
          value={String(config.exportScale)}
          onChange={(e) => {
            const v = e.target.value
            void apply({ exportScale: v === 'native' ? 'native' : (Number(v) as ExportScale) })
          }}
        >
          {SCALES.map((s) => (
            <option key={String(s.value)} value={String(s.value)}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="hint">
          Relative to the snip as it appears on screen. "Match screenshot" keeps every captured pixel at 1:1.
        </p>
      </section>

      {message && <p className={`message ${message.kind}`}>{message.text}</p>}
    </div>
  )
}
