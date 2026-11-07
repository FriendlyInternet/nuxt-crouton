import { describe, it, expect } from 'vitest'
import { resolveTranslationConfig } from '../../lib/generate-collection.ts'
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
