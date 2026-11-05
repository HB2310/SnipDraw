import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { DARK_CHROME_CLASS, darkChromeCss } from './dark-chrome'
import { fitImage } from './geometry'

const require = createRequire(import.meta.url)
const excalidrawCss = readFileSync(
  require.resolve('@excalidraw/excalidraw/index.css').replace(/dist[\\/]dev/, 'dist/prod'),
  'utf8'
)

describe('darkChromeCss (against the installed Excalidraw stylesheet)', () => {
  const css = darkChromeCss(excalidrawCss)
  const rules = css.split('\n')

  it('ports every dark-theme rule to the light root, scoped to our wrapper', () => {
    const darkRules = (excalidrawCss.match(/[^{}]*theme--dark[^{}]*\{/g) ?? []).length
    expect(darkRules).toBeGreaterThan(10)
    expect(rules.length).toBe(darkRules + 1) // + the filter override
    for (const r of rules) expect(r.startsWith(`.${DARK_CHROME_CLASS} `)).toBe(true)
  })

  it('leaves no theme--dark selectors behind (except the unrelated -background-none modifier)', () => {
    expect(css.replace(/theme--dark-background-none/g, '')).not.toContain('theme--dark')
  })

  it('only uses classes Excalidraw applies in light mode (it has no theme--light class)', () => {
    expect(excalidrawCss).not.toContain('theme--light')
    expect(css).not.toContain('theme--light')
  })

  it('carries over the dark UI variables', () => {
    expect(css).toMatch(/\.snipdraw-dark-chrome \.excalidraw\{[^}]*--island-bg-color/)
  })

  it('disables the inversion filter', () => {
    expect(rules.at(-1)).toContain('--theme-filter:none')
    // the canvas rule now resolves to that variable, i.e. no filter
    expect(css).toContain('.snipdraw-dark-chrome .excalidraw canvas{filter:var(--theme-filter)')
  })
})

describe('fitImage pixel snapping', () => {
  it.each([1, 1.25, 1.5, 1.75, 2])('puts the image corner on a whole device pixel at dpr %f', (dpr) => {
    const img = { width: 333.6, height: 211.2 } // e.g. 417x264 px at 125%
    const f = fitImage(img, { width: 951, height: 523 }, dpr)
    expect(f.zoom).toBe(1)
    const left = (-img.width / 2 + f.scrollX) * dpr
    const top = (-img.height / 2 + f.scrollY) * dpr
    expect(Math.abs(left - Math.round(left))).toBeLessThan(1e-9)
    expect(Math.abs(top - Math.round(top))).toBeLessThan(1e-9)
  })
})
