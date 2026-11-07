import { describe, it, expect } from 'vitest'
import { resolveTranslationConfig } from '../../lib/generate-collection.ts'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import coreManifest from '../../../crouton-core/crouton.manifest.ts'
import editorManifest from '../../../crouton-editor/crouton.manifest.ts'
import { getTypeMapping } from '../../lib/utils/manifest-loader.ts'
import { loadFields } from '../../lib/utils/load-fields.ts'
import { buildTranslationField, generateFormComponent } from '../../lib/generators/form-component.ts'

const f = (name: string, type: string, translatable?: boolean, component?: string) => ({ name, type, translatableType: translatable, component, meta: {} }) as any

function detect(fields: any[]) {
  const config = resolveTranslationConfig({ fields, config: null, collectionConfig: { translatable: true }, noTranslations: false, plural: 'posts' })
  return config?.translations?.collections?.posts ?? []
}

describe('collection-level translatable auto-detect reads the manifest flag', () => {
  it('includes manifest-translatable types (string, text, richText)', () => {
    expect(detect([f('title', 'string', true, 'UInput'), f('content', 'richText', true, 'CroutonEditorSimple')])).toEqual(['title', 'content'])
  })
  it('skips non-translatable types even with a matching name', () => {
    expect(detect([f('name', 'number')])).toEqual([])
  })
})

describe('translation field editor', () => {
  it('uses the manifest component for a richText translatable field', () => {
    const out = buildTranslationField(true, ['content'], [f('content', 'richText', true, 'CroutonEditorSimple')], 'posts')
    expect(out).toContain('field-components')
    expect(out).toContain('content: ')
  })
  it('leaves plain inputs on the default', () => {
    const out = buildTranslationField(true, ['title'], [f('title', 'string', true, 'UInput')], 'posts')
    expect(out).not.toContain('field-components')
  })
})

describe('auto-detect with the real manifests (no hand-built translatable flag)', () => {
  it('marks a richText schema field translatable and auto-detect picks it up', async () => {
    const mapping = getTypeMapping([coreManifest as any, editorManifest as any])
    const dir = await mkdtemp(join(tmpdir(), 'crouton-autodetect-'))
    const p = join(dir, 'schema.json')
    await writeFile(p, JSON.stringify({ title: { type: 'string' }, content: { type: 'richText' }, count: { type: 'number' } }))
    try {
      const fields = await loadFields(p, mapping)
      expect(fields.find(x => x.name === 'content')?.translatableType).toBe(true)
      expect(fields.find(x => x.name === 'count')?.translatableType).toBeFalsy()
      expect(detect(fields)).toEqual(['title', 'content'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('auto-detect edge cases and the generated form', () => {
  it('does not detect a json field even when its name is on the auto-detect list', () => {
    expect(detect([f('content', 'json')])).toEqual([])
  })

  it('noTranslations: true skips detection entirely', () => {
    const config = resolveTranslationConfig({ fields: [f('title', 'string', true, 'UInput')], config: null, collectionConfig: { translatable: true }, noTranslations: true, plural: 'posts' })
    expect(config?.translations?.collections?.posts ?? []).toEqual([])
  })

  const formData = (fields: any[]) => ({
    pascalCase: 'Post', pascalCasePlural: 'Posts', layerPascalCase: 'Blog', layerCamelCase: 'blog',
    plural: 'posts', singular: 'post', layer: 'blog', fields
  })
  const formConfig = { translations: { collections: { posts: ['content'] } } }

  it('generateFormComponent renders the translated editor for a richText field', () => {
    const out = generateFormComponent(formData([f('content', 'richText', true, 'CroutonEditorSimple')]), formConfig)
    expect(out).toContain('<CroutonI18nInput')
    expect(out).toContain('CroutonEditorSimple')
  })

  it('an explicit meta.component wins over the manifest component', () => {
    const field = { ...f('content', 'richText', true, 'CroutonEditorSimple'), meta: { component: 'MyCustomEditor' } }
    const out = generateFormComponent(formData([field]), formConfig)
    expect(out).toContain('MyCustomEditor')
    expect(out).not.toContain('CroutonEditorSimple')
  })
})
