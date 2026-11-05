import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadFields } from '../../../lib/utils/load-fields.ts'
import { generateRepeaterItemSchema } from '../../../lib/generators/composable.ts'
import { generateFieldComponents } from '../../../lib/generators/field-components.ts'

const entry = (zod: string, tsType: string, canonical: string, component: string) =>
  ({ db: '', sqlite: { column: 'text' }, zod, default: '', tsType, canonical, component })

// Manifest-shaped mapping: repeater/reference/image/file are NOT in the old private maps.
const typeMapping = {
  string: entry('z.string()', 'string', 'string', 'UInput'),
  repeater: entry('z.array(z.any())', 'any[]', 'repeater', 'CroutonFormRepeater'),
  reference: entry('z.string()', 'string', 'reference', 'CroutonFormReferenceSelect'),
  image: entry('z.string()', 'string', 'image', 'CroutonImageUpload'),
  file: entry('z.string()', 'string', 'file', 'CroutonImageUpload'),
}

describe('repeater property types come from the manifest (#2907)', () => {
  it('stamps manifest tsType/zod and generators emit them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crouton-prop-'))
    const p = join(dir, 's.json')
    await writeFile(p, JSON.stringify({
      items: {
        type: 'repeater',
        meta: { properties: { sub: { type: 'repeater' }, ref: { type: 'reference' }, img: { type: 'image' }, doc: { type: 'file' } } }
      }
    }))
    try {
      const [field] = await loadFields(p, typeMapping as any)
      const props = field.meta.properties
      expect(props.sub).toMatchObject({ tsType: 'any[]', zod: 'z.array(z.any())' })
      for (const k of ['ref', 'img', 'doc']) expect(props[k]).toMatchObject({ tsType: 'string', zod: 'z.string()' })

      const schema = generateRepeaterItemSchema(field as any, 'shop', 'Products').code
      expect(schema).toContain('sub: z.array(z.any()).optional()')

      const data = { pascalCase: 'Product', pascalCasePlural: 'Products', layerPascalCase: 'Shop', layerCamelCase: 'shop', plural: 'products', singular: 'product', layer: 'shop', fields: [field] }
      const { input } = generateFieldComponents(field as any, data)
      expect(input).toContain('sub?: any[]')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
