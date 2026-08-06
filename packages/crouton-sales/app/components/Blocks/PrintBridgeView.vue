<script setup lang="ts">
/**
 * Print Bridge Block — editor view (#127).
 *
 * NodeView placeholder for the page editor: a small mock of the bridge with
 * edit/delete controls, opens the property panel on double-click. Explicit
 * imports — VueNodeViewRenderer bypasses Nuxt auto-imports (mirrors the other
 * sales block views).
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface PrintBridgeAttrs {
  eventSlug?: string
}

const props = defineProps<{
  node: { attrs: PrintBridgeAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<PrintBridgeAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const { t } = useI18n()

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
    data-type="print-bridge-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <div class="p-3">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              <UIcon name="i-lucide-printer" class="w-3 h-3" />
              {{ t('sales.block.printBridge') }}
            </span>
            <UBadge
              v-if="attrs.eventSlug"
              color="primary"
              variant="subtle"
              size="sm"
              class="font-mono"
            >
              {{ attrs.eventSlug }}
            </UBadge>
            <UBadge
              v-else
              color="warning"
              variant="subtle"
              size="sm"
            >
              {{ t('sales.block.noEventPicked') }}
            </UBadge>
          </div>
          <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            <UButton
              icon="i-lucide-edit-3"
              size="xs"
              color="neutral"
              variant="ghost"
              :title="t('sales.block.editBlock')"
              @click.stop="handleOpenPanel"
            />
            <UButton
              icon="i-lucide-trash-2"
              size="xs"
              color="error"
              variant="ghost"
              :title="t('sales.block.deleteBlock')"
              @click.stop="deleteNode"
            />
          </div>
        </div>

        <!-- Mini bridge preview: a row of ticket cards with a print button -->
        <UCard :ui="{ body: 'p-3' }">
          <div class="grid grid-cols-3 gap-2">
            <div v-for="tile in 3" :key="tile" class="rounded-md bg-default border border-default p-2 space-y-1.5">
              <div class="h-3 w-8 rounded bg-primary/30" />
              <div class="h-2 w-full rounded bg-accented" />
              <div class="h-4 w-full rounded bg-primary/40 mt-1" />
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </NodeViewWrapper>
</template>
