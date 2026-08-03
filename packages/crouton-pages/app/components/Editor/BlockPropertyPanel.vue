<script setup lang="ts">
/**
 * Block Property Panel
 *
 * Slideover panel for editing block properties.
 * Renders appropriate inputs based on block schema.
 *
 * Uses LOCAL STATE ISOLATION pattern (inspired by Nuxt Studio):
 * - Form inputs bind to local refs only
 * - Changes are applied on explicit "Done" action
 * - Prevents feedback loops and focus stealing
 */
import type { Node } from '@tiptap/pm/model'
import type { BlockType, BlockPropertySchema, BlockSize } from '../../types/blocks'
import { getBlockDefinition } from '../../utils/block-registry'

const { t } = useT()
const { blockName, fieldLabel, fieldDescription, fieldOptions } = useBlockI18n()

// Addon blocks from croutonBlocks registry
const { getBlock: getAddonBlock } = useCroutonBlocks()

// CMS pages for the `page` field picker (resolved to canonical URLs at render).
const { pageOptions } = usePageLink()

interface Props {
  node: Node
}

const props = defineProps<Props>()

const emit = defineEmits<{
  update: [attrs: Record<string, unknown>]
  delete: []
  close: []
}>()

// Get block definition and schema — check core blocks first, then addon blocks
const blockType = computed(() => props.node.type.name as BlockType)
const blockDefinition = computed(() => {
  const coreDef = getBlockDefinition(blockType.value)
  if (coreDef) return coreDef
  // Fall back to addon block definition
  const addonDef = getAddonBlock(blockType.value)
  if (addonDef) {
    return {
      type: addonDef.type,
      name: addonDef.name,
      description: addonDef.description,
      icon: addonDef.icon,
      category: addonDef.category,
      defaultAttrs: addonDef.defaultAttrs,
      schema: addonDef.schema as BlockPropertySchema[]
    }
  }
  return undefined
})

// Resolve custom property component from addon block definitions
function getAddonPropertyComponent(fieldType: string): string | null {
  const addonDef = getAddonBlock(blockType.value)
  return addonDef?.propertyComponents?.[fieldType] || null
}

// Local state for editing (copy of node attrs)
// Changes are ONLY applied when user clicks "Done"
const localAttrs = ref<Record<string, unknown>>({})

// Expose the live, editing-in-progress block attrs to custom property
// components (the addon `propertyComponents` editors), so an editor can read
// SIBLING fields — e.g. the sales kitchen-display LocationsPicker scopes its
// options to the block's currently-picked `eventSlug`. Opt-in via inject, so
// editors that don't need it are unaffected. The ref identity is stable
// (only `.value` is reassigned), and `.value` is deeply reactive, so consumers
// reading `blockAttrs.value.<field>` track live edits.
provide('croutonBlockAttrs', localAttrs)

// Track which block type we're editing to detect when a different block is selected
const editingBlockType = ref<string | null>(null)

// Initialize local attrs from node only when a NEW block is selected (different type)
// Also fills in defaultValue for schema fields missing from the node (e.g. newly added attributes)
watch(() => props.node, (node, oldNode) => {
  // Only reset if this is a different block TYPE (not just attrs changed from external update)
  if (node.type.name !== editingBlockType.value) {
    const attrs = { ...node.attrs }
    // Fill in defaults for schema fields not present on the node
    const schema = blockDefinition.value?.schema
    if (schema) {
      for (const field of schema) {
        if (attrs[field.name] === undefined && field.defaultValue !== undefined) {
          attrs[field.name] = field.defaultValue
        }
      }
    }
    localAttrs.value = attrs
    editingBlockType.value = node.type.name
  }
}, { immediate: true })

// Live preview - reflects localAttrs in real-time (before Done)
const previewDoc = computed(() => ({
  type: 'doc',
  content: [{ type: blockType.value, attrs: localAttrs.value }]
}))

const showPreview = ref(true)

// Handle field change - LOCAL ONLY, no emit
// This is the key to preventing feedback loops
function onFieldChange(fieldName: string, value: unknown) {
  localAttrs.value[fieldName] = value
  // NOTE: We do NOT emit here - changes are batched and applied on "Done"
}

// Denormalize member data into contact block attrs for public page rendering
function onMemberDataChange(data: { firstName?: string; lastName?: string; email?: string; avatar?: string }) {
  for (const [key, value] of Object.entries(data)) {
    localAttrs.value[key] = value
  }
}

// Apply all changes and close
function onDone() {
  // Emit all local changes at once
  emit('update', { ...localAttrs.value })
  emit('close')
}

// Block size options (universal for all block types)
const blockSizeOptions = [
  { label: t('pages.blocks.sizeDefault'), value: 'default' as BlockSize },
  { label: t('pages.blocks.sizeNarrow'), value: 'narrow' as BlockSize },
  { label: t('pages.blocks.sizeWide'), value: 'wide' as BlockSize },
  { label: t('pages.blocks.sizeFull'), value: 'full' as BlockSize }
]

// Handle delete
function onDelete() {
  emit('delete')
}
t
</script>

<template>
  <div class="block-property-panel h-full flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-default">
      <div class="flex items-center gap-2">
        <UIcon
          v-if="blockDefinition?.icon"
          :name="blockDefinition.icon"
          class="size-5 text-primary"
        />
        <h3 class="text-lg font-semibold">
          {{ t('pages.blocks.blockSettings', { name: blockDefinition ? blockName(blockDefinition) : t('pages.blocks.unknownBlock') }) }}
        </h3>
      </div>
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        size="sm"
        @click="emit('close')"
      />
    </div>

    <!-- Live Block Preview -->
    <div class="border-b border-default">
      <UButton
        color="neutral"
        variant="ghost"
        block
        class="justify-between rounded-none px-4 py-2.5"
        :trailing-icon="showPreview ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="showPreview = !showPreview"
      >
        <span class="flex items-center gap-2 text-muted text-sm font-medium">
          <UIcon name="i-lucide-eye" class="size-3.5" />
          {{ t('pages.editor.livePreview') }}
        </span>
      </UButton>
      <div v-if="showPreview" class="relative overflow-hidden bg-muted/10" style="height: 200px;">
        <div style="transform: scale(0.33); transform-origin: top center; width: 303%; margin-left: -101.5%; pointer-events: none;">
          <CroutonPagesBlockContent :content="previewDoc as any" class="p-4" />
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto p-4">
      <div v-if="blockDefinition" class="space-y-4">
        <!-- Block Size (universal for all block types) -->
        <UFormField :label="t('pages.blocks.blockSize')" name="blockSize">
          <USelect
            :model-value="(localAttrs.blockSize as string) || 'default'"
            :items="blockSizeOptions as any"
            value-key="value"
            class="w-full"
            @update:model-value="onFieldChange('blockSize', $event)"
          />
        </UFormField>

        <USeparator />

        <template v-for="field in blockDefinition.schema" :key="field.name">
          <template v-if="!field.visibleWhen || field.visibleWhen(localAttrs)">
          <!-- Text Input -->
          <UFormField
            v-if="field.type === 'text'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <UInput
              :model-value="localAttrs[field.name] as string || ''"
              class="w-full"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Textarea -->
          <UFormField
            v-else-if="field.type === 'textarea'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <UTextarea
              :model-value="localAttrs[field.name] as string || ''"
              :rows="3"
              class="w-full"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Select -->
          <UFormField
            v-else-if="field.type === 'select'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <USelect
              :model-value="localAttrs[field.name] as string || field.defaultValue as string"
              :items="fieldOptions(blockType, field) as any"
              value-key="value"
              class="w-full"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Page Picker -->
          <UFormField
            v-else-if="field.type === 'page'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <USelectMenu
              :model-value="localAttrs[field.name] as string || ''"
              :items="pageOptions"
              value-key="value"
              class="w-full"
              :placeholder="t('pages.blockLibrary.qrCode.fields.pageId.placeholder', 'Select a page')"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Switch -->
          <UFormField
            v-else-if="field.type === 'switch'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <USwitch
              :model-value="localAttrs[field.name] as boolean || false"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Icon Picker -->
          <UFormField
            v-else-if="field.type === 'icon'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonIconPicker
              :model-value="localAttrs[field.name] as string || ''"
              size="sm"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Image Editor -->
          <UFormField
            v-else-if="field.type === 'image'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesImageEditor
              :model-value="(localAttrs[field.name] as string) || ''"
              :crop="field.crop"
              @update:model-value="onFieldChange(field.name, $event)"
              @update:alt="onFieldChange(field.name + 'Alt', $event)"
            />
          </UFormField>

          <!-- Links Editor -->
          <UFormField
            v-else-if="field.type === 'links'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesLinksEditor
              :model-value="(localAttrs[field.name] as any[]) || []"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Features Editor -->
          <UFormField
            v-else-if="field.type === 'features'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesFeaturesEditor
              :model-value="(localAttrs[field.name] as any[]) || []"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Cards Editor -->
          <UFormField
            v-else-if="field.type === 'cards'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesCardsEditor
              :model-value="(localAttrs[field.name] as any[]) || []"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Collection Picker -->
          <UFormField
            v-else-if="field.type === 'collection'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesCollectionPicker
              :model-value="localAttrs[field.name] as string || ''"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- FAQ Items Editor -->
          <UFormField
            v-else-if="field.type === 'faq-items'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesFaqItemsEditor
              :model-value="(localAttrs[field.name] as any[]) || []"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- File Editor -->
          <UFormField
            v-else-if="field.type === 'file'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesFileEditor
              :model-value="(localAttrs[field.name] as string) || ''"
              @update:model-value="onFieldChange(field.name, $event)"
              @update:file-name="onFieldChange('fileName', $event)"
            />
          </UFormField>

          <!-- Video Editor -->
          <UFormField
            v-else-if="field.type === 'video'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesVideoEditor
              :model-value="(localAttrs[field.name] as string) || ''"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Button Row Items Editor -->
          <UFormField
            v-else-if="field.type === 'button-row-items'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesButtonRowEditor
              :model-value="(localAttrs[field.name] as any[]) || []"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Logos Editor -->
          <UFormField
            v-else-if="field.type === 'logos'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesLogosEditor
              :model-value="(localAttrs[field.name] as any[]) || []"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Gallery Items Editor -->
          <UFormField
            v-else-if="field.type === 'gallery-items'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesGalleryEditor
              :model-value="(localAttrs[field.name] as any[]) || []"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Stats Items Editor -->
          <UFormField
            v-else-if="field.type === 'stats-items'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesStatsEditor
              :model-value="(localAttrs[field.name] as any[]) || []"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>

          <!-- Team Member Picker -->
          <UFormField
            v-else-if="field.type === 'team-member'"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <CroutonPagesBlocksPropertiesTeamMemberPicker
              :model-value="localAttrs[field.name] as string || ''"
              @update:model-value="onFieldChange(field.name, $event)"
              @update:member-data="onMemberDataChange"
            />
          </UFormField>

          <!-- Custom property component from addon blocks (e.g. chart-preset picker) -->
          <UFormField
            v-else-if="getAddonPropertyComponent(field.type)"
            :label="fieldLabel(blockType, field)"
            :name="field.name"
            :description="fieldDescription(blockType, field)"
          >
            <component
              :is="getAddonPropertyComponent(field.type)!"
              :model-value="localAttrs[field.name] as string || ''"
              @update:model-value="onFieldChange(field.name, $event)"
            />
          </UFormField>
          </template>
        </template>
      </div>

      <div v-else class="text-center text-muted py-8">
        <UIcon name="i-lucide-alert-circle" class="size-8 mb-2" />
        <p>{{ t('pages.editor.unknownBlockType') }}</p>
      </div>
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-between p-4 border-t border-default">
      <UButton
        color="error"
        variant="ghost"
        icon="i-lucide-trash-2"
        size="sm"
        @click="onDelete"
      >
        {{ t('pages.editor.deleteBlock') }}
      </UButton>
      <UButton
        color="primary"
        size="sm"
        @click="onDone"
      >
        {{ t('pages.editor.done') }}
      </UButton>
    </div>
  </div>
</template>
