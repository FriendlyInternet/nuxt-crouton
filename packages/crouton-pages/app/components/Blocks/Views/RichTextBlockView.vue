<script setup lang="ts">
/**
 * Rich Text Block Editor View
 *
 * Read-only: shows the stored HTML through the public renderer (which
 * sanitizes it), so the editor and the site never render it differently (#4436).
 */
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { RichTextBlockAttrs } from '../../../types/blocks'

// TipTap passes updateAttributes (and other props) to every node view; this
// read-only view never edits, so keep undeclared props off the DOM instead.
defineOptions({ inheritAttrs: false })

defineProps<{
  node: { attrs: RichTextBlockAttrs }
  selected: boolean
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
</script>

<template>
  <NodeViewWrapper data-type="rich-text-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-type"
      :label="t('pages.blockLibrary.richText.name')"
      @delete="deleteNode"
    >
      <CroutonPagesBlocksRenderRichTextBlock :attrs="node.attrs" />
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
