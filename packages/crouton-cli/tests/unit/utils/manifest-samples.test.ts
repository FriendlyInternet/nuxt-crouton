import { describe, it, expect } from 'vitest'
import { typeMapping } from '../../helpers/manifest-fields.ts'
import { getSeedGenerator } from '../../../lib/utils/helpers.ts'
import { generateSeedFixture } from '../../../lib/generators/collection-seed-fixture.ts'
import { sampleLiteral } from '../../../lib/generators/collection-test.ts'

// Every manifest type must declare its own sample values — no type may fall to
// a default string (#2910).
describe('manifest-declared sample values', () => {
  const canonical = Object.entries(typeMapping).filter(([name, def]) => name === def.canonical)

  it('covers every type the manifests declare', () => {
    expect(canonical.map(([n]) => n)).toEqual(expect.arrayContaining(
      ['string', 'text', 'number', 'decimal', 'boolean', 'date', 'json', 'repeater', 'array', 'reference', 'image', 'file', 'richText'],
    ))
  })

  for (const [name, def] of canonical) {
    it(`${name}: yields a seed generator, a fixture value and a test sample`, () => {
      expect(def.seed.drizzleSeed).toBeTruthy()
      expect(def.seed.fixture).toBeTruthy()
      expect(def.testSample).toBeTruthy()

      const field = { name: 'zzzSample', type: name, meta: {}, seed: def.seed, testSample: def.testSample }
      expect(getSeedGenerator(field)).toBe(def.seed.drizzleSeed)
      expect(sampleLiteral(field)).toBe(def.testSample)
      const fixture = generateSeedFixture({ layer: 'x', plural: 'things', fields: [field] })!
      expect(fixture.rows).toHaveLength(3)
      expect(fixture.rows[0].zzzSample).toBeDefined()
    })
  }
})
