<script setup lang="ts">
/**
 * CTA Block Editor View
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { CTABlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: CTABlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<CTABlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)

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
    data-type="cta-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <!-- Block Content -->
      <div class="p-3">
        <!-- Block Header -->
        <div class="flex items-center justify-between mb-2">
          <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            CTA
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
        <div class="text-center">
          <h3 class="text-base font-bold text-gray-900 dark:text-white mb-1">
            {{ attrs.title || 'Call to Action' }}
          </h3>
          <p v-if="attrs.description" class="text-sm text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">
            {{ attrs.description }}
          </p>
          <div v-if="attrs.links?.length" class="flex justify-center gap-1.5">
            <span
              v-for="(link, index) in attrs.links"
              :key="index"
              class="px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded text-xs"
            >
              {{ link.label }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
