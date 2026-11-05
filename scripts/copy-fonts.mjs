// Copies Excalidraw's bundled fonts into the renderer public dir so they are
// served from the app itself (no CDN / network access at runtime).
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts')
const dest = join(root, 'src/renderer/public/fonts')

if (!existsSync(src)) {
  console.error(`[copy-fonts] Excalidraw fonts not found at ${src}`)
  process.exit(1)
}
rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
console.log('[copy-fonts] Excalidraw fonts copied to src/renderer/public/fonts')
