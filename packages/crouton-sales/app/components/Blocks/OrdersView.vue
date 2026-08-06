<script setup lang="ts">
/**
 * Standalone Orders block — editor view.
 *
 * NodeView component for the page editor: shows a placeholder (mock orders
 * list) + edit/delete controls, opens the property panel on double-click.
 * Like the other sales block views, uses explicit imports —
 * VueNodeViewRenderer bypasses Nuxt auto-imports.
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface OrdersAttrs {
  eventSlug?: string
}

const props = defineProps<{
  node: { attrs: OrdersAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<OrdersAttrs>) => void
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
    data-type="sales-orders-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <div class="p-3">
        <!-- Header -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              <UIcon name="i-lucide-shopping-bag" class="w-3 h-3" />
              {{ t('sales.block.orders') }}
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

        <!-- Mini orders preview: a list of order rows with a status dot. -->
        <UCard :ui="{ body: 'p-4' }">
          <div class="space-y-1.5">
            <div v-for="row in 4" :key="row" class="flex items-center gap-2 h-6 rounded bg-elevated px-2">
              <span class="size-2 rounded-full bg-success/50 shrink-0" />
              <span class="h-2 flex-1 rounded bg-accented" />
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </NodeViewWrapper>
</template>
