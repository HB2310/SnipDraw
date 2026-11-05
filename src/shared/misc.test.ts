import { describe, expect, it } from 'vitest'
import { defaultHotkey, eventToAccelerator, formatAccelerator } from './accelerator'
import { bgraToRgba } from './pixels'

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('eventToAccelerator', () => {
  it('builds Win+Shift+E', () => {
    expect(eventToAccelerator(key('KeyE', { metaKey: true, shiftKey: true }))).toBe('Super+Shift+E')
  })
  it('ignores modifier-only presses', () => {
    expect(eventToAccelerator(key('ShiftLeft', { shiftKey: true }))).toBeNull()
  })
  it('rejects bare letters and Shift+letter', () => {
    expect(eventToAccelerator(key('KeyA'))).toBeNull()
    expect(eventToAccelerator(key('KeyA', { shiftKey: true }))).toBeNull()
  })
  it('allows bare F-keys and PrintScreen', () => {
    expect(eventToAccelerator(key('F9'))).toBe('F9')
    expect(eventToAccelerator(key('PrintScreen'))).toBe('PrintScreen')
  })
  it('maps punctuation and digits', () => {
    expect(eventToAccelerator(key('Digit4', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+4')
    expect(eventToAccelerator(key('Slash', { ctrlKey: true }))).toBe('Ctrl+/')
  })
})

describe('formatAccelerator', () => {
  it('shows Super as Win', () => {
    expect(formatAccelerator('Super+Shift+E')).toBe('Win+Shift+E')
    expect(formatAccelerator('CommandOrControl+Alt+S')).toBe('Ctrl+Alt+S')
  })
})

describe('bgraToRgba', () => {
  it('swaps channels and forces alpha (aligned fast path)', () => {
    const src = new Uint8Array([10, 20, 30, 0, 1, 2, 3, 4])
    const dst = new Uint8ClampedArray(8)
    bgraToRgba(src, 2, 1, dst)
    expect([...dst]).toEqual([30, 20, 10, 255, 3, 2, 1, 255])
  })
  it('handles row padding (stride > width*4)', () => {
    // 1x2 image with 8-byte stride
    const src = new Uint8Array([10, 20, 30, 40, 0, 0, 0, 0, 50, 60, 70, 80, 0, 0, 0, 0])
    const dst = new Uint8ClampedArray(8)
    bgraToRgba(src, 1, 2, dst)
    expect([...dst]).toEqual([30, 20, 10, 255, 70, 60, 50, 255])
  })
  it('handles unaligned buffers', () => {
    const backing = new Uint8Array(9)
    backing.set([10, 20, 30, 40, 50, 60, 70, 80], 1)
    const src = backing.subarray(1)
    const dst = new Uint8ClampedArray(8)
    bgraToRgba(src, 2, 1, dst)
    expect([...dst]).toEqual([30, 20, 10, 255, 70, 60, 50, 255])
  })
})

describe('macOS accelerators', () => {
  it('records the ⌘ key as Command', () => {
    expect(eventToAccelerator(key('KeyE', { metaKey: true, shiftKey: true }), 'darwin')).toBe('Command+Shift+E')
    expect(eventToAccelerator(key('KeyS', { ctrlKey: true, altKey: true }), 'darwin')).toBe('Ctrl+Alt+S')
  })
  it('formats with symbols in Apple order (⌃⌥⇧⌘)', () => {
    expect(formatAccelerator('Command+Shift+E', 'darwin')).toBe('⇧⌘E')
    expect(formatAccelerator('Shift+Command+Alt+Ctrl+K', 'darwin')).toBe('⌃⌥⇧⌘K')
    expect(formatAccelerator('CommandOrControl+Enter', 'darwin')).toBe('⌘↩')
    // A Windows-style hotkey still reads correctly on a Mac.
    expect(formatAccelerator('Super+Shift+E', 'darwin')).toBe('⇧⌘E')
  })
  it('keeps Windows formatting unchanged', () => {
    expect(formatAccelerator('Command+Shift+E', 'win32')).toBe('Win+Shift+E')
    expect(formatAccelerator('Shift+Ctrl+Alt+X', 'win32')).toBe('Ctrl+Alt+Shift+X')
  })
  it('has a platform default', () => {
    expect(defaultHotkey('darwin')).toBe('Command+Shift+E')
    expect(defaultHotkey('win32')).toBe('Super+Shift+E')
  })
})
