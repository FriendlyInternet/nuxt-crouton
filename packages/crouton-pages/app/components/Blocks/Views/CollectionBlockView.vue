<script setup lang="ts">
/**
 * Collection Block Editor View
 *
 * NodeView component for rendering collection blocks in the editor.
 * Shows a preview of the block with edit controls.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { CollectionBlockAttrs, CollectionLayout } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: CollectionBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<CollectionBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()

// Shorthand for attrs
const attrs = computed(() => props.node.attrs)

// Get layout display name
const layoutNames = computed<Record<CollectionLayout, string>>(() => ({
  table: t('pages.blocks.layoutNames.table'),
  list: t('pages.blocks.layoutNames.list'),
  grid: t('pages.blocks.layoutNames.grid'),
  cards: t('pages.blocks.layoutNames.cards')
}))

const layoutDisplay = computed(() => layoutNames.value[attrs.value.layout] || t('pages.blocks.layoutNames.table'))

// Reference to inner element for finding parent editor
const innerRef = ref<HTMLElement | null>(null)

// Find the editor ID by traversing up the DOM
function findEditorId(): string | undefined {
  let el: HTMLElement | null = innerRef.value
  while (el) {
    if (el.classList?.contains('crouton-editor-blocks') && el.dataset?.editorId) {
      return el.dataset.editorId
    }
    el = el.parentElement
  }
  return undefined
}

// Handler that opens property panel by dispatching a custom event
function handleOpenPanel() {
  // Find editorId at click time (more reliable than caching on mount)
  const editorId = findEditorId()
  const event = new CustomEvent('block-edit-request', {
    bubbles: true,
    detail: { node: props.node, pos: props.getPos(), editorId }
  })
  document.dispatchEvent(event)
}
</script>

<template>
  <NodeViewWrapper
    class="block-wrapper my-1 cursor-pointer"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    data-type="collection-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <!-- Block Content -->
      <div class="p-3">
        <!-- Block Header -->
        <div class="flex items-center justify-between mb-2">
          <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
            {{ t('pages.blocks.typeLabels.collection') }}
          </span>
          <!-- Action buttons -->
          <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              square
              icon="i-lucide-pencil"
              class="text-dimmed hover:text-primary"
              :aria-label="t('pages.blocks.editBlock')"
              :title="t('pages.blocks.editBlock')"
              @click.stop="handleOpenPanel"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              square
              icon="i-lucide-trash-2"
              class="text-dimmed hover:text-error"
              :aria-label="t('pages.blocks.deleteBlock')"
              :title="t('pages.blocks.deleteBlock')"
              @click.stop="deleteNode"
            />
          </div>
        </div>

        <!-- Preview Content -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50">
          <!-- Warning if no collection selected -->
          <div v-if="!attrs.collection" class="flex items-center gap-2 text-amber-600 dark:text-amber-500">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="text-sm font-medium">{{ t('pages.blocks.collection.noCollectionSelected') }}</span>
          </div>

          <!-- Collection info -->
          <div v-else class="space-y-2">
            <!-- Title if set -->
            <h3 v-if="attrs.title" class="font-semibold text-gray-900 dark:text-white">
              {{ attrs.title }}
            </h3>

            <!-- Collection badge -->
            <div class="flex items-center gap-2 flex-wrap">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
                {{ attrs.collection }}
              </span>
              <span class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
                {{ layoutDisplay }}
              </span>
              <span class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
                {{ t('pages.blocks.collection.itemsPerPage', { count: attrs.pageSize }) }}
              </span>
            </div>

            <!-- Visual placeholder for collection -->
            <div class="mt-3 grid gap-1">
              <div
                v-for="i in 3"
                :key="i"
                class="h-2 rounded bg-gray-200 dark:bg-gray-600"
                :style="{ width: `${100 - (i * 15)}%` }"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
