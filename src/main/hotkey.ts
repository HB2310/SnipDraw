import { globalShortcut } from 'electron'

/** Owns the single user-configurable global hotkey. */
export class Hotkey {
  private registered: string | null = null
  private suspended = false

  constructor(private readonly onTrigger: () => void) {}

  get current(): string | null {
    return this.registered
  }

  get isRegistered(): boolean {
    return !!this.registered && !this.suspended
  }

  /**
   * Register `accelerator`, replacing the previous one. Returns an error message
   * on failure, in which case the previous hotkey (if any) stays active.
   */
  set(accelerator: string): string | null {
    const previous = this.registered
    if (previous === accelerator && !this.suspended && globalShortcut.isRegistered(accelerator)) return null
    if (previous) globalShortcut.unregister(previous)

    let ok = false
    let invalid = false
    try {
      ok = globalShortcut.register(accelerator, this.onTrigger)
    } catch {
      invalid = true
    }
    if (ok) {
      this.registered = accelerator
      this.suspended = false
      return null
    }
    // Put the old one back so the user isn't left without a hotkey.
    if (previous && previous !== accelerator) {
      try {
        globalShortcut.register(previous, this.onTrigger)
      } catch {
        /* ignore */
      }
    }
    this.registered = previous && previous !== accelerator ? previous : null
    return invalid
      ? `"${accelerator}" is not a valid shortcut.`
      : `"${accelerator}" could not be registered. Another app (or Windows) is probably using it.`
  }

  /** Temporarily release the hotkey (while Settings is recording a new one). */
  suspend(): void {
    if (this.registered && !this.suspended) {
      globalShortcut.unregister(this.registered)
      this.suspended = true
    }
  }

  resume(): void {
    if (this.registered && this.suspended) {
      this.suspended = false
      try {
        if (!globalShortcut.register(this.registered, this.onTrigger)) this.registered = null
      } catch {
        this.registered = null
      }
    }
  }
}

/** Esc as a temporary global shortcut while overlays are up, in case an overlay doesn't have focus. */
export function registerEscape(onEscape: () => void): () => void {
  let ok = false
  try {
    ok = globalShortcut.register('Escape', onEscape)
  } catch {
    ok = false
  }
  return () => {
    if (ok) globalShortcut.unregister('Escape')
  }
}
