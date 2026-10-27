import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { generateCollectionReadme } from '../../../lib/generators/collection-readme.ts'
import { basicComposableData, hierarchyData, minimalConfig } from '../../fixtures/sample-data.mjs'
import { metadataFields } from '../../../lib/utils/system-fields.ts'

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2025-01-01'))
})
afterAll(() => vi.useRealTimers())

// The generated README is the one place a builder reads what they own (#2286).
// It leads with the lifecycle — generate once, then it's yours — and stays short:
// the long API / usage walkthrough duplicated crouton-core's docs and is gone.
describe('generateCollectionReadme', () => {
  const readme = () => generateCollectionReadme(basicComposableData, minimalConfig)

  it('says plainly that the files are generated once and then owned by the app', () => {
    expect(readme()).toContain('Generated once')
    expect(readme()).toContain("it's yours")
    expect(readme()).toContain('--force')
  })

  it('keeps the orientation table, the fields and the file map', () => {
    expect(readme()).toContain('`shopProducts`')
    expect(readme()).toContain('/api/teams/[teamId]/shop-products')
    expect(readme()).toContain('| name | string |')
    expect(readme()).toContain('Form.vue')
  })

  it('lists the system columns from the single enumeration', () => {
    for (const name of metadataFields()) {
      expect(readme()).toContain(`| ${name} |`)
    }
  })

  it('drops the API walkthrough and the customization guide', () => {
    expect(readme()).not.toContain('## API Endpoints')
    expect(readme()).not.toContain('## Customization Guide')
    expect(readme()).not.toContain('$fetch(')
  })

  it('mentions the tree endpoints only for a hierarchy collection', () => {
    expect(readme()).not.toContain('move.patch.ts')
    expect(generateCollectionReadme(hierarchyData, minimalConfig)).toContain('move.patch.ts')
  })

  it('matches the snapshot', () => {
    expect(readme()).toMatchSnapshot()
  })
})
