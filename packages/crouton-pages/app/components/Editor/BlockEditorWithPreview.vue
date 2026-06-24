<script setup lang="ts">
import { markRaw } from 'vue'
import type * as Y from 'yjs'
import { PageBlocks } from '../../editor/extensions/page-blocks'
/**
 * Page Block Editor with Preview
 *
 * Block editor with live preview panel showing rendered Nuxt UI Page components.
 * Uses tabs to switch between editor and preview.
 * Supports real-time collaboration via Yjs when yxmlFragment is provided.
 *
 * IMPORTANT: Extensions are created per-component-instance to avoid TipTap's
 * "Adding different instances of a keyed plugin" error that occurs when
 * module-level extensions are reused across editor remounts or HMR reloads.
 */
import { getBlockMenuItems } from '../../utils/block-registry'

const { t } = useT()
const { blockName, blockDescription } = useBlockI18n()

// Get addon blocks from croutonBlocks registry (chart, map, etc.)
const { blocksList: addonBlocks } = useCroutonBlocks()

// Create extensions once per component instance, wrapped in markRaw to prevent
// Vue's reactivity system from proxying TipTap internals
// Note: enableSlashCommands is false because we use UEditorSuggestionMenu instead
const pageBlockExtensions = markRaw([
  PageBlocks.configure({
    enableSlashCommands: false,
    addonBlocks: addonBlocks.value
  })
])

/** TipTap JSON document structure */
type TipTapDoc = { type: 'doc'; content: unknown[] }

interface BlockSuggestionItem {
  type: string
  label: string
  description?: string
  icon?: string
  category?: string
  command: string
}

interface Props {
  modelValue?: string | TipTapDoc | null
  placeholder?: string
  editable?: boolean
  /** Preview panel title */
  previewTitle?: string
  /** Default active tab */
  defaultTab?: 'editor' | 'preview'
  /**
   * Preview zoom scale (0.5 = 50%, 1 = 100%).
   * Smaller values show more content in less space.
   * @default 0.6
   */
  previewScale?: number
  /**
   * Y.XmlFragment for real-time collaboration.
   * When provided, editor syncs to Yjs instead of using modelValue.
   */
  yxmlFragment?: Y.XmlFragment
  /**
   * Collab provider for cursor awareness (optional).
   */
  collabProvider?: { awareness: any }
  /**
   * User info for collaboration cursors.
   */
  collabUser?: { name: string; color?: string }
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Type / to insert a block...',
  editable: true,
  previewTitle: 'Page Preview',
  defaultTab: 'editor',
  previewScale: 0.6
})

// Computed styles for zoom effect
const previewZoomStyle = computed(() => ({
  transform: `scale(${currentScale.value})`,
  transformOrigin: 'top left',
  width: `${100 / currentScale.value}%`
}))

const emit = defineEmits<{
  'update:modelValue': [value: string | TipTapDoc]
}>()

// Empty TipTap document - must have at least one paragraph node
const emptyDoc: TipTapDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

// Helper to normalize content — parse JSON strings into TipTap doc objects
function normalizeContent(value: string | TipTapDoc | null | undefined): string | TipTapDoc {
  if (value) {
    // Parse JSON strings (content stored as stringified TipTap JSON in DB)
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
          return (!parsed.content || parsed.content.length === 0) ? emptyDoc : parsed
        }
      } catch {
        // Not JSON — return as-is (plain text or HTML)
      }
      return value
    }
    if (typeof value === 'object') {
      const doc = value as TipTapDoc
      if (!doc.content || doc.content.length === 0) {
        return emptyDoc
      }
    }
    return value
  }
  return emptyDoc
}

// Local content state - tracks the current editor content for immediate preview updates
// This avoids waiting for the v-model round-trip through parent components
const localContent = ref<string | TipTapDoc>(normalizeContent(props.modelValue))

// Sync local content when prop changes from parent
watch(() => props.modelValue, (newValue) => {
  localContent.value = normalizeContent(newValue)
})

// Two-way binding for editor - writes to both local state AND emits to parent
const content = computed({
  get: () => localContent.value,
  set: (value) => {
    // Update local state immediately for preview
    localContent.value = value
    // Also emit to parent for form state
    emit('update:modelValue', value)
  }
})

// Preview content - uses local state for immediate updates
const previewContent = computed(() => localContent.value)

// Zoom state - can toggle between scaled and 100%
const isZoomedOut = ref(true)
const currentScale = computed(() => isZoomedOut.value ? props.previewScale : 1)

// Tab state
const activeTab = ref(props.defaultTab)
const tabItems = [
  { label: t('pages.editor.tabEditor'), value: 'editor', icon: 'i-lucide-edit-3' },
  { label: t('pages.editor.tabPreview'), value: 'preview', icon: 'i-lucide-eye' }
]

// Block suggestion items — core + addon blocks
const blockSuggestionItems = computed<BlockSuggestionItem[]>(() => {
  const coreItems = getBlockMenuItems()
    .filter(item => item.type !== 'richTextBlock')
    .map(item => ({
      type: item.type,
      label: blockName(item),
      description: blockDescription(item),
      icon: item.icon,
      category: getCategoryLabel(item.category),
      command: getInsertCommand(item.type)
    }))

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

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    hero: t('pages.blocks.categories.hero'),
    content: t('pages.blocks.categories.content'),
    cta: t('pages.blocks.categories.cta'),
    layout: t('pages.blocks.categories.layout')
  }
  return labels[category] || category
}

function getInsertCommand(type: string): string {
  return `insert${type.charAt(0).toUpperCase()}${type.slice(1)}`
}

// Editor ref
const editorBlocksRef = ref()

// Fullscreen "focus mode": pop the editor (+preview tabs) into a fullscreen
// modal. We TELEPORT the same editor DOM into the modal (rather than mounting a
// second instance) so content, cursor and collab state are preserved.
const isFullscreen = ref(false)
const fsTargetRef = ref<HTMLElement | null>(null)


// Property panel state (managed here, not in CroutonEditorBlocks)
const selectedNode = ref<{ pos: number; node: any } | null>(null)
const isPropertyPanelOpen = ref(false)

function closePropertyPanel() {
  isPropertyPanelOpen.value = false
}

function updateBlockAttrs(attrs: Record<string, unknown>) {
  editorBlocksRef.value?.updateBlockAttrs(attrs)
}

function deleteBlock() {
  editorBlocksRef.value?.deleteSelectedBlock()
  closePropertyPanel()
}

// Expose editor utilities
defineExpose({
  get editor() {
    return editorBlocksRef.value?.editor
  },
  get selectedNode() {
    return selectedNode.value
  },
  openPropertyPanel() {
    if (selectedNode.value) {
      isPropertyPanelOpen.value = true
    }
  },
  updateBlockAttrs,
  deleteSelectedBlock() {
    return editorBlocksRef.value?.deleteSelectedBlock()
  },
  showEditor() {
    activeTab.value = 'editor'
  },
  showPreview() {
    activeTab.value = 'preview'
  }
})
</script>

<template>
  <div class="block-editor-with-preview w-full h-full flex flex-col">
    <!-- The editor body teleports into the fullscreen modal when expanded
         (same instance → content/cursor/collab preserved). -->
    <Teleport :to="fsTargetRef" :disabled="!isFullscreen || !fsTargetRef">
      <div class="flex h-full min-h-0 flex-col" :class="isFullscreen ? 'p-3' : ''">
        <!-- Tab buttons + fullscreen toggle -->
        <div class="flex items-center gap-2">
          <UTabs v-model="activeTab" :items="tabItems" :content="false" class="flex-1" :ui="{ indicator: 'bg-primary/10', trigger: 'data-[state=active]:text-primary' }" />
          <UButton
            :icon="isFullscreen ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="isFullscreen ? t('pages.editor.exitFullscreen', 'Exit fullscreen') : t('pages.editor.fullscreen', 'Fullscreen')"
            @click="isFullscreen = !isFullscreen"
          />
        </div>

        <!-- Editor Tab -->
        <div
          v-show="activeTab === 'editor'"
          class="flex-1 min-h-0 pt-2"
        >
          <CroutonEditorBlocks
            ref="editorBlocksRef"
            v-model="content"
            :placeholder="placeholder"
            :editable="editable"
            :extensions="pageBlockExtensions"
            :suggestion-items="blockSuggestionItems"
            :yxml-fragment="yxmlFragment"
            :collab-provider="collabProvider"
            :collab-user="collabUser"
            content-type="json"
            class="h-full border border-default rounded-lg"
            @block:select="(node) => selectedNode = node"
            @block:edit="(node) => { selectedNode = node; isPropertyPanelOpen = true }"
          />
        </div>

        <!-- Preview Tab -->
        <div
          v-show="activeTab === 'preview'"
          class="flex-1 min-h-0 pt-2"
        >
          <div class="border border-default rounded-lg overflow-hidden h-full flex flex-col">
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-2 border-b border-default bg-muted/30 flex-shrink-0">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-eye" class="size-4 text-muted" />
                <span class="text-sm font-medium">{{ previewTitle }}</span>
              </div>
              <!-- Zoom toggle -->
              <UButton
                :icon="isZoomedOut ? 'i-lucide-zoom-in' : 'i-lucide-zoom-out'"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="isZoomedOut ? t('pages.editor.zoomTo100') : t('pages.editor.zoomToPercent', { percent: Math.round(previewScale * 100) })"
                @click="isZoomedOut = !isZoomedOut"
              >
                <span class="text-xs text-muted ml-1">{{ Math.round(currentScale * 100) }}%</span>
              </UButton>
            </div>

            <!-- Preview content - uses local state for immediate updates -->
            <!-- Zoomed out to show more content in small containers -->
            <div class="flex-1 overflow-auto">
              <div :style="previewZoomStyle">
                <CroutonPagesBlockContent
                  :content="previewContent as any"
                  class="p-4"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Inline placeholder shown while the editor is teleported into fullscreen -->
    <button
      v-if="isFullscreen"
      type="button"
      class="flex-1 min-h-[120px] flex items-center justify-center gap-2 rounded-lg border border-dashed border-default text-sm text-muted hover:text-default hover:border-primary transition-colors"
      @click="isFullscreen = true"
    >
      <UIcon name="i-lucide-maximize-2" class="size-4" />
      {{ t('pages.editor.editingFullscreen', 'Editing in fullscreen…') }}
    </button>

    <!-- Fullscreen modal: hosts the teleported editor -->
    <UModal v-model:open="isFullscreen" fullscreen :ui="{ content: 'bg-default' }">
      <template #content>
        <div ref="fsTargetRef" class="h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" />
      </template>
    </UModal>

    <!-- Property Panel - Rendered at root level for proper z-index/overlay -->
    <USlideover
      v-model:open="isPropertyPanelOpen"
      :title="t('pages.editor.editBlock')"
      :ui="{ content: 'max-w-md' }"
    >
      <template #body>
        <CroutonPagesEditorBlockPropertyPanel
          v-if="selectedNode"
          :key="`block-panel-${selectedNode.pos}`"
          :node="selectedNode.node"
          @update="updateBlockAttrs"
          @delete="deleteBlock"
          @close="closePropertyPanel"
        />
      </template>
    </USlideover>
  </div>
</template>


