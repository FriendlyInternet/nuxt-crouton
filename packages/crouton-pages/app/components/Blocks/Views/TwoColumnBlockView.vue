<script setup lang="ts">
/**
 * Two Column Block Editor View
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { TwoColumnBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: TwoColumnBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<TwoColumnBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)
const innerRef = ref<HTMLElement | null>(null)

const splitLabel = computed(() => {
  const map: Record<string, string> = {
    '1/2': '50 / 50',
    '1/3': '33 / 67',
    '2/3': '67 / 33'
  }
  return map[attrs.value.split || '1/2'] ?? '50 / 50'
})

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
    data-type="two-column-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <div class="p-3">
        <div class="flex items-center justify-between mb-2">
          <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            Two Columns · {{ splitLabel }}
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

        <!-- Simplified two-column preview -->
        <div class="grid gap-2" :class="attrs.split === '1/3' ? 'grid-cols-[1fr_2fr]' : attrs.split === '2/3' ? 'grid-cols-[2fr_1fr]' : 'grid-cols-2'">
          <div class="bg-gray-50 dark:bg-gray-800/50 rounded p-2 min-h-[48px]">
            <p class="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
              {{ attrs.leftTitle || 'Left column' }}
            </p>
            <p v-if="attrs.leftDescription" class="text-[11px] text-gray-400 truncate mt-0.5">
              {{ attrs.leftDescription }}
            </p>
          </div>
          <div class="bg-gray-50 dark:bg-gray-800/50 rounded p-2 min-h-[48px]">
            <p class="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
              {{ attrs.rightTitle || 'Right column' }}
            </p>
            <p v-if="attrs.rightDescription" class="text-[11px] text-gray-400 truncate mt-0.5">
              {{ attrs.rightDescription }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
