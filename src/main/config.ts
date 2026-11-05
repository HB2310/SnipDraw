import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { defaultHotkey } from '../shared/accelerator'
import type { AppConfig, ExportScale } from '../shared/types'

export const DEFAULT_CONFIG: AppConfig = {
  hotkey: defaultHotkey(process.platform),
  autoSaveHistory: true,
  exportScale: 2
}

const EXPORT_SCALES: readonly ExportScale[] = ['native', 1, 2, 3]

let current: AppConfig = { ...DEFAULT_CONFIG }

export function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** Coerce whatever is on disk into a valid config, falling back per field. */
export function sanitizeConfig(raw: unknown): AppConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    hotkey: typeof r.hotkey === 'string' && r.hotkey.trim() ? r.hotkey.trim() : DEFAULT_CONFIG.hotkey,
    autoSaveHistory: typeof r.autoSaveHistory === 'boolean' ? r.autoSaveHistory : DEFAULT_CONFIG.autoSaveHistory,
    exportScale: EXPORT_SCALES.includes(r.exportScale as ExportScale)
      ? (r.exportScale as ExportScale)
      : DEFAULT_CONFIG.exportScale
  }
}

export function loadConfig(): AppConfig {
  try {
    current = sanitizeConfig(JSON.parse(readFileSync(configPath(), 'utf8')))
  } catch {
    current = { ...DEFAULT_CONFIG }
  }
  return current
}

export function getConfig(): AppConfig {
  return current
}

/** In-memory only (used by the dev self-test so it never touches the user's config file). */
export function overrideConfig(patch: Partial<AppConfig>): void {
  current = sanitizeConfig({ ...current, ...patch })
}

export function saveConfig(next: AppConfig): AppConfig {
  current = sanitizeConfig(next)
  const file = configPath()
  mkdirSync(dirname(file), { recursive: true })
  // Write-then-rename so a crash mid-write can't leave a truncated config.
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf8')
  renameSync(tmp, file)
  return current
}
