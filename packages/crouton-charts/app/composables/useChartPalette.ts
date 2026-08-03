import { getChartColor } from '../utils/chart-constants'

/**
 * Resolves the theme's primary color (as an OKLCH string) at runtime and hands
 * back a reactive `colorAt(index, total)` for chart series colors.
 *
 * Why runtime + client-only: `var(--ui-primary)` does NOT resolve inside an SVG
 * `fill`/`stop-color` presentation attribute, so the chart lib needs a literal
 * color value. Nuxt UI 4 stores the primary as an OKLCH string (from
 * `tailwindcss/colors`, Tailwind v4), so `getComputedStyle` reads it back
 * verbatim and we feed it straight through — no color library, no conversion.
 *
 * `--ui-primary` (not `--ui-color-primary-500`) is the mode-correct alias:
 * shade 500 in light, 400 in dark. We re-read on color-mode change and on any
 * `<html>` class/style mutation (theme / Look-and-Feel swaps) so charts recolor
 * live. SSR renders with `primary=null` → the static palette, then the client
 * re-derives after mount (no hydration flash: same categories, only colors
 * differ, which the chart lib applies reactively).
 */
export function useChartPalette() {
  const primary = ref<string | null>(null)
  const colorMode = useColorMode()

  function readPrimary() {
    if (!import.meta.client) return
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue('--ui-primary')
      .trim()
    if (v && v !== primary.value) primary.value = v
  }

  let observer: MutationObserver | null = null
  onMounted(() => {
    readPrimary()
    // Catch dark-mode class flips and runtime theme-var swaps (Look-and-Feel).
    observer = new MutationObserver(() => readPrimary())
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style']
    })
  })
  onUnmounted(() => observer?.disconnect())
  // Belt-and-braces: color-mode toggles the .dark class, but the composable may
  // outlive a class-only observe window during navigation.
  watch(() => colorMode.value, () => nextTick(readPrimary))

  function colorAt(index: number, total: number): string {
    return getChartColor(index, total, primary.value)
  }

  return { primary, colorAt }
}
