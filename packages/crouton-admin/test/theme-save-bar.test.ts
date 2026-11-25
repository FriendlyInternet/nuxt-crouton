import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * #4536 — the unsaved-changes bar on the Look & Feel page is a solid, wrapping
 * Nuxt UI UAlert (vertical on phones, one row from `sm`), not a hand-styled
 * 5%-opaque flex row that crushes its label at 390px.
 *
 * Source-shape test: crouton-admin has no component-mount harness (vitest env
 * `node`), so this reads the component the page actually renders.
 */
const source = readFileSync(
  fileURLToPath(new URL('../app/components/TeamThemeSettings.vue', import.meta.url)),
  'utf8'
)

function saveBarBlock(): string {
  const start = source.indexOf('v-if="hasChanges"')
  expect(start).toBeGreaterThan(-1)
  const open = source.lastIndexOf('<', start)
  const end = source.indexOf('/>', start)
  return source.slice(open, end + 2)
}

describe('TeamThemeSettings unsaved-changes bar', () => {
  // covers: T1
  it('is an outline UAlert with a solid background that stacks on phones', () => {
    const bar = saveBarBlock()
    expect(bar.startsWith('<UAlert')).toBe(true)
    expect(bar).toContain('variant="outline"')
    expect(bar).toContain('orientation="horizontal"')
    expect(bar).toMatch(/class="[^"]*\bsticky\b[^"]*"/)
    expect(bar).toMatch(/class="[^"]*\bbg-default\b[^"]*"/)
    expect(bar).toMatch(/root: '[^']*flex-col[^']*sm:flex-row[^']*'/)
    expect(bar).toContain(':actions="saveBarActions"')
  })

  // covers: T1
  it('no longer uses the see-through background', () => {
    // (the selected preset card keeps its own bg-primary/5 tint on purpose)
    expect(saveBarBlock()).not.toContain('bg-primary/5')
  })
})
