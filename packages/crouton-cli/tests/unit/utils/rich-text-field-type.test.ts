import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import coreManifest from '../../../../crouton-core/crouton.manifest.ts'
import editorManifest from '../../../../crouton-editor/crouton.manifest.ts'
import { getTypeMapping } from '../../../lib/utils/manifest-loader.ts'
import { loadFields } from '../../../lib/utils/load-fields.ts'
import { generateFormComponent } from '../../../lib/generators/form-component.ts'

async function load(typeMapping: Record<string, any>) {
  const dir = await mkdtemp(join(tmpdir(), 'crouton-richtext-'))
  const p = join(dir, 'schema.json')
  await writeFile(p, JSON.stringify({ body: { type: 'richText', meta: { translatable: true } } }))
  try {
    return await loadFields(p, typeMapping)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('richText field type (editor manifest)', () => {
  it('loads as a text column with CroutonEditorSimple when crouton-editor is extended', async () => {
    const mapping = getTypeMapping([coreManifest as any, editorManifest as any])
    const [body] = await load(mapping)
    expect(body.type).toBe('richText')
    expect(body.zod).toBe('z.string()')
    expect(body.component).toBe('CroutonEditorSimple')
    expect(mapping.richText.db).toBe('TEXT')
    expect(mapping.richText.drizzle).toBe(mapping.text.drizzle)
  })

  it('renders CroutonEditorSimple in _Form.vue', async () => {
    const mapping = getTypeMapping([coreManifest as any, editorManifest as any])
    const fields = await load(mapping)
    const out = generateFormComponent(
      { singular: 'note', plural: 'notes', pascalCase: 'Note', pascalCasePlural: 'Notes', camelCase: 'note', camelCasePlural: 'notes', layer: 'test', layerPascalCase: 'Test', layerCamelCase: 'test', fields } as any,
      {} as any,
    )
    expect(out).toContain('<CroutonEditorSimple')
  })

  it('is rejected as an unknown type without crouton-editor', async () => {
    const mapping = getTypeMapping([coreManifest as any])
    await expect(load(mapping)).rejects.toThrow(/Field "body" has unknown type "richText"/)
  })
})
