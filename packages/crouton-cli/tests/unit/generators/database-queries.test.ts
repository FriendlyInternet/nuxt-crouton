/**
 * #2311 — the queries generator imports a package-owned reference from the package.
 *
 * Three import shapes exist: external (`~~/server/db/schema`), cross-layer (relative path up to
 * `layers/`), same-layer sibling. A collection a package owns lives in none of those places —
 * it is in `node_modules/@fyit/<pkg>/collections/<name>/server/database/schema` — so the
 * generator needs a fourth shape, and the join must use the package's table (`croutonAssets`).
 */
import { describe, it, expect } from 'vitest'
import { generateQueries } from '../../../lib/generators/database-queries.ts'
import { apiEndpointData } from '../../fixtures/sample-data.mjs'

const data = {
  ...apiEndpointData,
  singular: 'gallery',
  plural: 'galleries',
  camelCase: 'gallery',
  camelCasePlural: 'galleries',
  pascalCase: 'Gallery',
  pascalCasePlural: 'Galleries',
  layer: 'main',
  layerPascalCase: 'Main',
  layerCamelCase: 'main',
  fields: [
    { name: 'name', type: 'string', meta: { required: true } },
    { name: 'imageId', type: 'string', refTarget: 'assets', meta: {} },
  ],
}

const ASSETS_IMPORT = '@fyit/crouton-assets/collections/assets/server/database/schema'

describe('generateQueries — package-owned reference', () => {
  it('imports the schema from the owning package and joins its table', () => {
    const out = generateQueries(
      data,
      null,
      'main',
      new Map([['assets', 'crouton']]),
      new Map([['assets', { importPath: ASSETS_IMPORT }]]),
    )
    expect(out).toContain(`import * as assetsSchema from '${ASSETS_IMPORT}'`)
    expect(out).toContain('.leftJoin(assetsSchema.croutonAssets, eq(tables.mainGalleries.imageId, assetsSchema.croutonAssets.id))')
    expect(out).not.toContain("'../../../assets/server/database/schema'")
  })

  it('keeps the same-layer sibling import when the target is not package-owned', () => {
    const out = generateQueries(data, null, 'main', new Map([['assets', 'main']]))
    expect(out).toContain("import * as assetsSchema from '../../../assets/server/database/schema'")
    expect(out).toContain('assetsSchema.mainAssets')
  })

  it('keeps the cross-layer import when the target lives in another app layer', () => {
    const out = generateQueries(data, null, 'main', new Map([['assets', 'media']]))
    expect(out).toContain("import * as assetsSchema from '../../../../../media/collections/assets/server/database/schema'")
    expect(out).toContain('assetsSchema.mediaAssets')
  })
})
