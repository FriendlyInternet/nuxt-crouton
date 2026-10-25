<script setup lang="ts">
/**
 * QR Code Block Editor View
 *
 * Compact in-editor representation: a QR glyph plus the linked page/URL label,
 * with edit/delete actions. The real scannable code renders on the public page.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { QrCodeBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: QrCodeBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<QrCodeBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const { items } = usePageLink()

const attrs = computed(() => props.node.attrs)

// Human label for the chosen destination.
const targetLabel = computed(() => {
  if (attrs.value.pageId) {
    const page = items.value.find(p => p.id === attrs.value.pageId)
    if (page) return page.title
  }
  if (attrs.value.url) return attrs.value.url
  return t('pages.blockLibrary.qrCode.noTarget', 'No page selected')
})



</script>

<template>
  <NodeViewWrapper data-type="qr-code-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-qr-code"
      :label="t('pages.blockLibrary.qrCode.name', 'QR Code')"
      @delete="deleteNode"
    >
      <p class="text-sm text-gray-600 dark:text-gray-300 truncate">
        {{ targetLabel }}
      </p>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
