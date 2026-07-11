<script setup lang="ts">
/**
 * Hero Block Editor View
 *
 * NodeView component for rendering hero blocks in the editor.
 * Shows a preview of the block with edit controls.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { HeroBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: HeroBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<HeroBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
// Shorthand for attrs
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
    data-type="hero-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <!-- Block Content -->
      <div class="p-3">
        <!-- Block Header -->
        <div class="flex items-center justify-between mb-2">
          <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            Hero
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
        <div class="flex items-center gap-4">
          <!-- Image thumbnail -->
          <div v-if="attrs.image" class="flex-shrink-0">
            <img
              :src="attrs.image"
              :alt="attrs.title || 'Hero image'"
              class="w-16 h-16 object-cover rounded"
            />
          </div>

          <!-- Text content -->
          <div class="flex-1 min-w-0" :class="{ 'text-center': !attrs.image }">
            <p v-if="attrs.headline" class="text-xs font-medium text-primary mb-1">
              {{ attrs.headline }}
            </p>
            <h2 class="text-lg font-bold text-gray-900 dark:text-white mb-1 truncate">
              {{ attrs.title || 'Hero Title' }}
            </h2>
            <p v-if="attrs.description" class="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
              {{ attrs.description }}
            </p>
            <div v-if="attrs.links?.length" class="mt-2 flex gap-1.5" :class="{ 'justify-center': !attrs.image }">
              <span
                v-for="(link, index) in attrs.links"
                :key="index"
                class="px-2.5 py-1 bg-primary/10 text-primary rounded text-xs"
              >
                {{ link.label }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
