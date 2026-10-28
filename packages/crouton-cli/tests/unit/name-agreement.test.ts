import { describe, it, expect } from 'vitest'
import { generateSeedFile } from '../../lib/generators/seed-data.ts'
import { buildSchemaExportNames } from '../../lib/generate-collection.ts'
import { registryKeyFor } from '../../lib/compose-layout.ts'
import { toCase, toLayerCamelCase, pascal } from '../../lib/utils/helpers.ts'

// One case helper: the schema export, the seed import, the registry key and the
// composable name must all derive the same identifier (#2738).
describe.each(['email-templates', 'order-items', 'news', 'settings'])('name agreement: %s', (collection) => {
  const layer = 'shop'
  const cases = toCase(collection)

  it('seed.ts imports the identifier schema.ts exports', async () => {
    const { exportName } = await buildSchemaExportNames(collection, layer)
    const seed = generateSeedFile({ plural: cases.plural, layer, fields: [] }, {})
    expect(seed).toContain(`import { ${exportName} } from './schema'`)
    expect(exportName).toMatch(/^[A-Za-z_$][\w$]*$/)
  })

  it('registry key matches the composable-derived key', () => {
    expect(registryKeyFor(layer, collection)).toBe(`${toLayerCamelCase(layer)}${cases.pascalCasePlural}`)
    // registries key on pascal(dir name); the dir name is the plural form
    expect(`${toLayerCamelCase(layer)}${pascal(cases.plural)}`).toBe(registryKeyFor(layer, collection))
  })
})
