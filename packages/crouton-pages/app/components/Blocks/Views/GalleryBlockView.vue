<script setup lang="ts">
/**
 * Gallery Block Editor View
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { GalleryBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: GalleryBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<GalleryBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)
const innerRef = ref<HTMLElement | null>(null)

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

function handleOpenPanel() {
  const editorId = findEditorId()
  const event = new CustomEvent('block-edit-request', {
    bubbles: true,
    detail: { node: props.node, pos: props.getPos(), editorId }
  })
  document.dispatchEvent(event)
}

const imageCount = computed(() => (attrs.value.images || []).length)
</script>

<template>
  <NodeViewWrapper
    class="block-wrapper my-1 cursor-pointer"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    data-type="gallery-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <div class="p-3">
        <!-- Block Header -->
        <div class="flex items-center justify-between mb-2">
          <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            <UIcon name="i-lucide-gallery-horizontal-end" class="size-3" />
            Gallery
          </span>
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
        <div>
          <h3 v-if="attrs.title" class="text-base font-bold text-gray-900 dark:text-white mb-1">
            {{ attrs.title }}
          </h3>

          <!-- Image thumbnails preview -->
          <div v-if="imageCount > 0" class="flex gap-1 overflow-hidden rounded">
            <img
              v-for="(image, index) in (attrs.images || []).slice(0, 5)"
              :key="index"
              :src="image.src"
              :alt="image.alt || ''"
              class="h-16 w-12 object-cover rounded"
            >
            <span v-if="imageCount > 5" class="flex items-center justify-center h-16 w-12 rounded bg-gray-100 dark:bg-gray-800 text-xs text-gray-500">
              +{{ imageCount - 5 }}
            </span>
          </div>
          <span v-else class="text-xs text-gray-400 italic">
            No images yet — double-click to add
          </span>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
