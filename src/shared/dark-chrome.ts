/**
 * Excalidraw's dark theme is two things at once: dark UI chrome (CSS variables
 * on `.excalidraw.theme--dark`), and an `invert(93%) hue-rotate(180deg)` filter
 * on the canvas, with images pre-filtered by `invert(100%) hue-rotate(180deg)
 * saturate(1.25)` to roughly cancel it out. "Roughly" is the problem for a
 * screenshot tool: whites render as #ededed, blacks as ~#111 and colors shift.
 *
 * So the editor runs Excalidraw in light mode (no filters: the screenshot and
 * annotation colors are shown exactly as they export) and re-applies the dark
 * theme's UI rules to the light root, with the canvas filter variable forced
 * to `none`. Excalidraw's own JS still treats the theme as light, so its
 * palette offers the light set (black, red, green, blue, orange) in true color. The rules are derived from Excalidraw's own stylesheet so they
 * track Excalidraw upgrades.
 */

export const DARK_CHROME_CLASS = 'snipdraw-dark-chrome'

/** Build CSS that gives a light-mode Excalidraw root the dark theme's UI. */
export function darkChromeCss(excalidrawCss: string, scope = `.${DARK_CHROME_CLASS}`): string {
  const out: string[] = []
  // Flat `selector { body }` rules. Excalidraw's dark rules are never nested in
  // @media/@supports (checked against 0.18), and inner rules of other
  // @-blocks are skipped because they don't mention theme--dark.
  const rule = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = rule.exec(excalidrawCss))) {
    const selectorList = m[1].trim()
    if (!selectorList.includes('theme--dark') || selectorList.startsWith('@')) continue
    const selectors = selectorList
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.includes('theme--dark'))
      // Excalidraw adds .theme--dark in dark mode but no theme class at all in
      // light mode, so drop the qualifier; the scope class keeps these rules
      // more specific than Excalidraw's light defaults.
      .map((s) => `${scope} ${s.replace(/\.theme--dark(?![\w-])/g, '')}`)
    if (selectors.length) out.push(`${selectors.join(',')}{${m[2]}}`)
  }
  // No inversion anywhere: canvas, color swatches and eye-dropper show true colors.
  out.push(`${scope} .excalidraw{--theme-filter:none;color-scheme:dark}`)
  return out.join('\n')
}
