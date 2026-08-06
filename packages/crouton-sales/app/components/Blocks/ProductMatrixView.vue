<script setup lang="ts">
/**
 * Product × Day Matrix Block Editor View
 *
 * NodeView preview for the page editor. Shows what the block is configured to
 * display and opens the property panel on edit. Uses explicit imports because
 * VueNodeViewRenderer bypasses Nuxt auto-imports.
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface SalesProductMatrixAttrs {
  eventScope?: string
  measure?: 'units' | 'revenue'
  title?: string
}

const props = defineProps<{
  node: { attrs: SalesProductMatrixAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<SalesProductMatrixAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const { t } = useI18n()

const measureLabel = computed(() => (attrs.value.measure === 'revenue' ? t('sales.block.revenue') : t('sales.block.units')))
const scopeLabel = computed(() => (attrs.value.eventScope ? t('sales.block.scopedEvent') : t('sales.block.allEvents')))

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
    data-type="sales-product-matrix-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <div class="p-3">
        <!-- Block Header -->
        <div class="flex items-center justify-between mb-2">
          <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            <UIcon name="i-lucide-table" class="w-3 h-3" />
            {{ t('sales.block.productMatrix') }}
          </span>
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

        <!-- Preview Content -->
        <UCard :ui="{ body: 'p-4 space-y-2' }">
          <h3 v-if="attrs.title" class="font-semibold text-highlighted">
            {{ attrs.title }}
          </h3>
          <div class="flex items-center gap-2 flex-wrap">
            <UBadge color="primary" variant="subtle" size="sm">
              <UIcon name="i-lucide-table" class="size-3.5" />
              {{ t('sales.block.productMatrix') }}
            </UBadge>
            <UBadge color="neutral" variant="subtle" size="sm">
              <UIcon name="i-lucide-calendar" class="size-3" />
              {{ scopeLabel }}
            </UBadge>
            <UBadge color="neutral" variant="subtle" size="sm">
              {{ measureLabel }}
            </UBadge>
          </div>
          <!-- Mini grid placeholder -->
          <div class="mt-2 grid grid-cols-5 gap-1">
            <div v-for="i in 15" :key="i" class="h-3 rounded-sm bg-elevated" />
          </div>
        </UCard>
      </div>
    </div>
  </NodeViewWrapper>
</template>
