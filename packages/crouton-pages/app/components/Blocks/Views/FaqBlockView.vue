<script setup lang="ts">
/**
 * FAQ Block Editor View
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { FaqBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: FaqBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<FaqBlockAttrs>) => void
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
</script>

<template>
  <NodeViewWrapper
    class="block-wrapper my-1 cursor-pointer"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    data-type="faq-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <div class="p-3">
        <div class="flex items-center justify-between mb-2">
          <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            FAQ
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

        <div>
          <p v-if="attrs.headline" class="text-xs font-medium text-purple-600 dark:text-purple-400 mb-1">
            {{ attrs.headline }}
          </p>
          <h3 class="text-base font-bold text-gray-900 dark:text-white mb-2">
            {{ attrs.title || 'FAQ' }}
          </h3>
          <div class="space-y-1">
            <div
              v-for="(item, index) in (attrs.items || []).slice(0, 3)"
              :key="index"
              class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
            >
              <UIcon name="i-lucide-chevron-right" class="size-3 text-gray-400 shrink-0" />
              <span class="truncate">{{ item.question }}</span>
            </div>
            <span v-if="(attrs.items || []).length > 3" class="text-xs text-gray-400 pl-5">
              +{{ attrs.items.length - 3 }} more
            </span>
            <span v-if="!attrs.items?.length" class="text-xs text-gray-400 italic">
              No questions yet
            </span>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
