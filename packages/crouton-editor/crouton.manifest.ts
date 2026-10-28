import { defineCroutonManifest, defineGeneratorContribution } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-editor',
  name: 'Rich Text Editor',
  description: 'Rich text editor - TipTap-based with slash commands, variables, and live preview',
  icon: 'i-lucide-pen-tool',
  version: '1.0.0',
  category: 'addon',
  aiHint: 'use when app has content/articles/posts/rich text',
  dependencies: [],

  // Rich text is a real field type: same TEXT column as `text`, edited with CroutonEditorSimple.
  // Only valid in apps that extend crouton-editor (core alone rejects it as an unknown type).
  fieldTypes: {
    richText: { label: 'Rich text', icon: 'i-lucide-pen-tool', description: 'Rich text content (TipTap editor, translatable)', db: 'TEXT', drizzle: 'text', zod: 'z.string()', tsType: 'string', defaultValue: "''", seed: { drizzleSeed: 'f.loremIpsum({ sentencesCount: 3 })', fixture: '`Sample ${name} content for row ${i + 1}.`' }, testSample: '\'sample\'', component: 'CroutonEditorSimple' },
  },

  provides: {
    composables: ['useEditorVariables'],
    components: [
      { name: 'CroutonEditorSimple', description: 'Full-featured TipTap editor wrapper with image upload and AI translation support', props: ['modelValue', 'placeholder', 'contentType', 'editable', 'enableImageUpload', 'enableTranslationAI'] },
      { name: 'CroutonEditorBlocks', description: 'Block-based editor with NodeView blocks and property panel slot', props: ['modelValue', 'placeholder', 'contentType', 'editable', 'extensions', 'showToolbar'] },
      { name: 'CroutonEditorVariables', description: 'Variable insertion menu triggered by {{ — for email templates and dynamic content', props: ['editor', 'variables', 'groups', 'char'] },
      { name: 'CroutonEditorPreview', description: 'Live preview with variable interpolation', props: ['content', 'title', 'values', 'variables', 'mode', 'expandable'] },
      { name: 'CroutonEditorWithPreview', description: 'Editor and preview side-by-side with responsive layout (tabs on mobile)', props: ['modelValue', 'variables', 'previewValues', 'previewTitle', 'contentType', 'editable', 'showVariableChips'] },
    ],
  },

  // Detection patterns — fields using Editor components trigger this package
  detects: {
    componentPatterns: ['CroutonEditorSimple', 'CroutonEditorBlocks', 'EditorSimple', 'EditorFull', 'Editor'],
  },
})

// ---------------------------------------------------------------------------
// Generator contribution — adds CroutonEditorPreview cell template for list
// ---------------------------------------------------------------------------

export const generatorContribution = defineGeneratorContribution({
  enhanceList(ctx) {
    const { detected } = ctx
    const { editorFields } = detected

    if (!editorFields.length) return null

    const cellTemplates: Record<string, string> = {}

    // Check which editor fields are translatable (need t() accessor)
    const translatableFieldNames: string[] = (ctx.collectionConfig as any)?.translatableFieldNames || []

    for (const field of editorFields) {
      const isTranslatable = translatableFieldNames.includes(field.name)
      const contentAccess = isTranslatable
        ? `t(row.original, '${field.name}')`
        : `row.original.${field.name}`

      cellTemplates[field.name] = `
    <template #${field.name}-cell="{ row }">
      <CroutonEditorPreview :content="${contentAccess}" mode="thumbnail" />
    </template>`
    }

    return { cellTemplates }
  },
})
