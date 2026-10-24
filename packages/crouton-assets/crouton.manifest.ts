import { defineCroutonManifest, defineGeneratorContribution } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-assets',
  name: 'Asset Management',
  description: 'Asset management - media library with NuxtHub blob storage',
  icon: 'i-lucide-folder-open',
  version: '1.0.0',
  category: 'addon',
  aiHint: 'use when app has media uploads or file management',
  dependencies: [],

  layer: {
    name: 'crouton',
    editable: false,
    reason: 'The table is croutonAssets (crouton_assets), shared by every app that extends this package.',
  },

  // The collection below ships from this package (collections/assets), end to end (#2278).
  // The CLI refuses to generate it into an app; `collections` stays as the
  // package's self-description for AI hints and docs.
  ownsCollections: true,

  collections: [
    {
      name: 'asset',
      tableName: 'croutonAssets',
      description: 'Media library: uploaded files in blob storage with alt text and dimensions',
      schemaPath: './assets-schema.json',
    },
  ],

  // Registers as 'assets' app — detectable via useCroutonApps().hasApp('assets')
  croutonApp: {
    id: 'assets',
    adminRoutes: [{ path: '/media', label: 'assets.admin.media', icon: 'i-lucide-image' }],
  },

  provides: {
    composables: ['useAssetUpload'],
    components: [
      { name: 'CroutonAssetsPicker', description: 'Asset picker with gallery modal for selecting from media library', props: ['modelValue', 'crop', 'collection'] },
      { name: 'CroutonAssetsLibrary', description: 'Full media library browser using CroutonCollection', props: ['collection'] },
      { name: 'CroutonAssetsUploader', description: 'Upload component with optional crop step and metadata form', props: ['modelValue'] },
      { name: 'CroutonAssetsCard', description: 'Media card for CroutonCollection grid (image/icon, edit/delete)', props: ['item'] },
      { name: 'CroutonAssetsAssetTile', description: 'Selection tile for Picker modal with selected state and checkmark', props: ['item', 'selected'] },
      { name: 'CroutonAssetsForm', description: 'Asset create/upload form (registered as packageForm for assets collection)', props: [] },
      { name: 'CroutonAssetsFormUpdate', description: 'Asset update/metadata edit form', props: ['item'] },
    ],
    apiRoutes: [
      '/api/assets/generate-alt-text',
    ],
    pages: [
      '/admin/[team]/media',
    ],
  },

  // Detection patterns — image/file field types and asset refTargets trigger this package
  detects: {
    fieldTypes: ['image', 'file'],
    refTargetPatterns: ['asset', 'file', 'image', 'media'],
  },
})

// ---------------------------------------------------------------------------
// Generator contribution — replaces CroutonImageUpload fallback with full picker
// ---------------------------------------------------------------------------

export const generatorContribution = defineGeneratorContribution({
  getFormComponent(ctx) {
    // When generating the assets collection itself, use the package's custom form
    if (ctx.collectionName === 'assets') return 'CroutonAssetsForm'
    return null
  },

  enhanceForm(ctx) {
    const { detected } = ctx
    const { assetFields } = detected

    if (!assetFields.length) return null

    const fieldOverrides: Record<string, string> = {}

    for (const field of assetFields) {
      const fieldLabel = field.name.charAt(0).toUpperCase() + field.name.slice(1)

      if (field.type === 'image') {
        fieldOverrides[field.name] = `        <UFormField label="${fieldLabel}" name="${field.name}" class="not-last:pb-4">
          <CroutonAssetsPicker
            v-model="state.${field.name}"
            :crop="true"
          />
        </UFormField>`
      } else if (field.type === 'file') {
        fieldOverrides[field.name] = `        <UFormField label="${fieldLabel}" name="${field.name}" class="not-last:pb-4">
          <CroutonAssetsPicker
            v-model="state.${field.name}"
          />
        </UFormField>`
      } else if (field.refTarget) {
        // Asset reference field — use picker with resolved collection
        const resolvedCollection = field.resolvedCollection || field.refTarget
        fieldOverrides[field.name] = `        <UFormField label="${fieldLabel}" name="${field.name}" class="not-last:pb-4">
          <CroutonAssetsPicker
            v-model="state.${field.name}"
            collection="${resolvedCollection}"
          />
        </UFormField>`
      }
    }

    return { fieldOverrides }
  },
})
