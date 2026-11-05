<script setup lang="ts">
/**
 * Page Block Editor
 *
 * Uses CroutonEditorBlocks with page-specific block extensions
 * (Hero, Section, CTA, CardGrid, Separator).
 */
import { markRaw } from 'vue'
import { PageBlocks } from '../../editor/extensions/page-blocks'
import { getBlockMenuItems } from '../../utils/block-registry'

const { t } = useT()
const { blockName, blockDescription } = useBlockI18n()

// Block suggestion item interface (matches CroutonEditorBlocks prop)
interface BlockSuggestionItem {
  type: string
  label: string
  description?: string
  icon?: string
  category?: string
  command: string
}

/** TipTap JSON document structure */
type TipTapDoc = { type: 'doc'; content: unknown[] }

interface Props {
  modelValue?: string | TipTapDoc | null
  placeholder?: string
  editable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  editable: true
})

const emit = defineEmits<{
  'update:modelValue': [value: string | TipTapDoc]
}>()

// Empty TipTap document - must have at least one paragraph node
const emptyDoc: TipTapDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

// Two-way binding - pass through to CroutonEditorBlocks
const content = computed({
  get: () => {
    if (props.modelValue) {
      // Parse JSON strings (content stored as stringified TipTap JSON in DB)
      if (typeof props.modelValue === 'string') {
        try {
          const parsed = JSON.parse(props.modelValue)
          if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
            return (!parsed.content || parsed.content.length === 0) ? emptyDoc : parsed
          }
        } catch {
          // Not JSON — return as-is (plain text or HTML)
        }
        return props.modelValue
      }
      // Ensure JSON docs have at least one node (TipTap requirement)
      if (typeof props.modelValue === 'object') {
        const doc = props.modelValue as TipTapDoc
        if (!doc.content || doc.content.length === 0) {
          return emptyDoc
        }
      }
      return props.modelValue
    }
    return emptyDoc
  },
  set: (value) => emit('update:modelValue', value)
})

// Get addon blocks from croutonBlocks registry (chart, map, etc.)
const { blocksList: addonBlocks } = useCroutonBlocks()

// Page block extensions - markRaw prevents Vue reactivity from interfering with TipTap
const pageBlockExtensions = markRaw([
  PageBlocks.configure({
    enableSlashCommands: false, // We use CroutonEditorBlocks suggestion menu instead
    addonBlocks: addonBlocks.value
  })
])

// Convert block menu items to suggestion items for CroutonEditorBlocks
// Includes both core blocks and addon blocks from croutonBlocks
const blockSuggestionItems = computed<BlockSuggestionItem[]>(() => {
  const coreItems = getBlockMenuItems()
    .filter(item => item.type !== 'richTextBlock') // Exclude rich text (it's just regular text)
    .map(item => ({
      type: item.type,
      label: blockName(item),
      description: blockDescription(item),
      icon: item.icon,
      category: getCategoryLabel(item.category),
      command: getInsertCommand(item.type)
    }))

  // Add addon blocks from croutonBlocks registry
  const addonItems = addonBlocks.value.map(def => ({
    type: def.type,
    label: blockName(def),
    description: blockDescription(def),
    icon: def.icon,
    category: getCategoryLabel(def.category),
    command: `insert${def.type.charAt(0).toUpperCase()}${def.type.slice(1)}`
  }))

  return [...coreItems, ...addonItems]
})

// Map category keys to display labels
function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    hero: t('pages.blocks.categories.hero'),
    content: t('pages.blocks.categories.content'),
    cta: t('pages.blocks.categories.cta'),
    layout: t('pages.blocks.categories.layout')
  }
  return labels[category] || category
}

// Map block type to insert command
function getInsertCommand(type: string): string {
  return `insert${type.charAt(0).toUpperCase()}${type.slice(1)}`
}

// Editor ref for external access
const editorBlocksRef = ref()

// Expose editor utilities
defineExpose({
  get editor() {
    return editorBlocksRef.value?.editor
  },
  get selectedNode() {
    return editorBlocksRef.value?.selectedNode
  },
  openPropertyPanel() {
    return editorBlocksRef.value?.openPropertyPanel()
  },
  updateBlockAttrs(attrs: Record<string, unknown>) {
    return editorBlocksRef.value?.updateBlockAttrs(attrs)
  },
  deleteSelectedBlock() {
    return editorBlocksRef.value?.deleteSelectedBlock()
  }
})
</script>

<template>
  <CroutonEditorBlocks
    ref="editorBlocksRef"
    v-model="content"
    :placeholder="placeholder ?? t('pages.editor.blockPlaceholder')"
    :editable="editable"
    :extensions="pageBlockExtensions"
    :suggestion-items="blockSuggestionItems"
    content-type="json"
    class="h-full"
  >
    <!-- Property Panel -->
    <template #property-panel="{ selectedNode, isOpen, close, updateAttrs, deleteBlock }">
      <USlideover
        :open="isOpen"
        :title="t('pages.editor.editBlock')"
        :ui="{ content: 'max-w-sm' }"
        @update:open="!$event && close()"
      >
        <template #body>
          <CroutonPagesEditorBlockPropertyPanel
            v-if="selectedNode"
            :node="selectedNode.node"
            @update="updateAttrs"
            @delete="deleteBlock"
            @close="close"
          />
        </template>
      </USlideover>
    </template>
  </CroutonEditorBlocks>
</template>
