/** Helpers for Electron accelerator strings (used by the Settings hotkey recorder). */

const CODE_MAP: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PrintScreen: 'PrintScreen',
  Pause: 'Pause',
  ScrollLock: 'Scrolllock',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec'
}

/** Map a KeyboardEvent.code to an accelerator key name, or null for modifiers/unknown keys. */
export function codeToKey(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]
  m = /^Digit([0-9])$/.exec(code)
  if (m) return m[1]
  m = /^Numpad([0-9])$/.exec(code)
  if (m) return `num${m[1]}`
  m = /^F([0-9]{1,2})$/.exec(code)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 24) return `F${m[1]}`
  return CODE_MAP[code] ?? null
}

export interface KeyLike {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * Build an accelerator from a key event. Returns null while only modifiers are
 * held, or for a bare key that would be unsafe as a global shortcut (a global
 * "E" would swallow every E typed system-wide). F-keys, PrintScreen and Pause
 * are allowed without modifiers.
 */
export function eventToAccelerator(e: KeyLike, platform: string = 'win32'): string | null {
  const key = codeToKey(e.code)
  if (!key) return null
  const mods: string[] = []
  // The Win/⌘ key is "Super" on Windows and "Command" on macOS (same key code).
  if (platform === 'darwin' && e.metaKey) mods.push('Command')
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (platform !== 'darwin' && e.metaKey) mods.push('Super')
  if (e.shiftKey) mods.push('Shift')
  const standalone = /^F\d+$/.test(key) || key === 'PrintScreen' || key === 'Pause'
  if (mods.length === 0 && !standalone) return null
  // Shift alone + a printable key is still "typing"; require another modifier.
  if (mods.length === 1 && mods[0] === 'Shift' && !standalone) return null
  return [...mods, key].join('+')
}

type Mod = 'ctrl' | 'alt' | 'shift' | 'meta'

function modOf(part: string, platform: string): Mod | null {
  switch (part.toLowerCase()) {
    case 'super':
    case 'meta':
    case 'cmd':
    case 'command':
      return 'meta'
    case 'commandorcontrol':
    case 'cmdorctrl':
      return platform === 'darwin' ? 'meta' : 'ctrl'
    case 'control':
    case 'ctrl':
      return 'ctrl'
    case 'option':
    case 'alt':
      return 'alt'
    case 'shift':
      return 'shift'
    default:
      return null
  }
}

const MAC_SYMBOLS: Record<Mod, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
const MAC_KEYS: Record<string, string> = { Enter: '↩', Return: '↩', Up: '↑', Down: '↓', Left: '←', Right: '→', Backspace: '⌫', Delete: '⌦', Tab: '⇥', Escape: '⎋', Esc: '⎋' }
const WIN_NAMES: Record<Mod, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' }

/**
 * Human-friendly label for an accelerator.
 * Windows: "Super+Shift+E" -> "Win+Shift+E". macOS: "Command+Shift+E" -> "⇧⌘E"
 * (modifiers in Apple's canonical ⌃⌥⇧⌘ order).
 */
export function formatAccelerator(acc: string, platform: string = 'win32'): string {
  const parts = acc.split('+').filter(Boolean)
  const mods = new Set<Mod>()
  const keys: string[] = []
  for (const p of parts) {
    const m = modOf(p, platform)
    if (m) mods.add(m)
    else keys.push(p)
  }
  if (platform === 'darwin') {
    const order: Mod[] = ['ctrl', 'alt', 'shift', 'meta']
    return order.filter((m) => mods.has(m)).map((m) => MAC_SYMBOLS[m]).join('') + keys.map((k) => MAC_KEYS[k] ?? k).join('')
  }
  const order: Mod[] = ['ctrl', 'alt', 'meta', 'shift']
  return [...order.filter((m) => mods.has(m)).map((m) => WIN_NAMES[m]), ...keys].join('+')
}

/** The default snip hotkey for a platform (Win+Shift+E / ⇧⌘E). */
export function defaultHotkey(platform: string): string {
  return platform === 'darwin' ? 'Command+Shift+E' : 'Super+Shift+E'
}
