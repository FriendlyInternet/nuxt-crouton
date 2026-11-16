import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMapConfig } from '../../app/composables/useMapConfig'

function stub(maps: unknown) {
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { maps } }))
}

describe('useMapConfig style (#3398)', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('resolves a preset name to its style URL', () => {
    stub({ style: 'positron' })
    expect(useMapConfig().style).toBe('https://tiles.openfreemap.org/styles/positron')
  })

  it('passes a full style URL through unchanged', () => {
    stub({ style: 'https://example.com/style.json' })
    expect(useMapConfig().style).toBe('https://example.com/style.json')
  })

  it('defaults to liberty', () => {
    stub(undefined)
    expect(useMapConfig().style).toBe('https://tiles.openfreemap.org/styles/liberty')
  })
})
