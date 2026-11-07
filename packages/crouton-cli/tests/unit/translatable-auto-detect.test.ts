import { describe, it, expect } from 'vitest'
import { resolveTranslationConfig } from '../../lib/generate-collection.ts'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import coreManifest from '../../../crouton-core/crouton.manifest.ts'
import editorManifest from '../../../crouton-editor/crouton.manifest.ts'
import { getTypeMapping } from '../../lib/utils/manifest-loader.ts'
import { loadFields } from '../../lib/utils/load-fields.ts'
import { buildTranslationField } from '../../lib/generators/form-component.ts'

const f = (name: string, type: string, translatable?: boolean, component?: string) => ({ name, type, translatable, component, meta: {} }) as any

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
      expect(fields.find(x => x.name === 'content')?.translatable).toBe(true)
      expect(fields.find(x => x.name === 'count')?.translatable).toBeFalsy()
      expect(detect(fields)).toEqual(['title', 'content'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
