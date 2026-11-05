import { describe, it, expect } from 'vitest'
import { replaceFeatureFlag } from '../../../lib/utils/manifest-configuration.ts'

describe('replaceFeatureFlag', () => {
  it('rewrites the property but leaves `maps: true` inside comments alone', () => {
    const src = `export default {
  // \`maps: true\` wires the package in.
  /* also maps: true here */
  features: {
    maps: true
  }
}
`
    const out = replaceFeatureFlag(src, 'maps', { config: { style: 'liberty' } })
    expect(out).toContain('// `maps: true` wires the package in.')
    expect(out).toContain('/* also maps: true here */')
    expect(out).toContain('"style": "liberty"')
    expect(out).not.toMatch(/maps: true\n  }/)
    // still parses
    const body = out.replace('export default', 'return')
    expect(() => new Function(body)()).not.toThrow()
  })
})
