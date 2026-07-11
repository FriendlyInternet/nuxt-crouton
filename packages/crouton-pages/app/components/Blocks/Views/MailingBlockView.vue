<script setup lang="ts">
/**
 * Mailing Block Editor View
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { MailingBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: MailingBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<MailingBlockAttrs>) => void
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
    data-type="mailing-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <div class="p-3">
        <!-- Block Header -->
        <div class="flex items-center justify-between mb-2">
          <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            <UIcon name="i-lucide-mail" class="size-3" />
            Mailing List
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
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-800/50 w-full">
            <UIcon name="i-lucide-mail" class="size-4 text-gray-400 shrink-0" />
            <span v-if="attrs.title" class="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
              {{ attrs.title }}
            </span>
            <span v-else class="text-xs text-gray-400 italic">
              No title set
            </span>
            <span v-if="attrs.actionUrl" class="ml-auto text-[10px] text-gray-400 truncate max-w-[200px]">
              {{ attrs.provider }}
            </span>
            <span v-else class="ml-auto text-[10px] text-amber-500">
              No URL
            </span>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
