<script setup lang="ts">
/**
 * Pane Block Editor View (#706 / #716) — the in-editor pane composer.
 *
 * Unlike most block views (a compact glyph + a side property panel), a pane
 * block is composed INLINE: it embeds the editable `CroutonLayout` (crouton-core)
 * so the author drags registered blocks into panes, resizes, nests, and
 * configures them right in the document. Edits write back to the node's `layout`
 * attribute, so they persist into the page's `content` JSON on save and reload
 * into the same arrangement (the deferred half of #716).
 *
 * Not on `CroutonBlockFrame` (#2415): this view has no property panel to open and no
 * edit button — its chrome is a header over an embedded composer, not a labelled
 * preview — so the shared frame's edit/dblclick behaviour does not apply.
 *
 * The composer is wrapped in a non-editable shell (`contenteditable=false`) so
 * TipTap doesn't fight CroutonLayout's own drag/resize handling.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import type { PaneBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: PaneBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<PaneBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()

const height = computed<number>(() => {
  const h = Number(props.node.attrs.height)
  return Number.isFinite(h) && h >= 160 && h <= 2000 ? h : 480
})

// Bridge the node attribute to CroutonLayout's v-model.
const layout = computed<LayoutTree | null>({
  get: () => props.node.attrs.layout ?? null,
  set: (value) => props.updateAttributes({ layout: value })
})
</script>

<template>
  <NodeViewWrapper
    class="pane-block-view my-2"
    :class="{ 'ring-2 ring-primary/50 rounded-xl': selected }"
    data-type="pane-block"
  >
    <div
      contenteditable="false"
      class="relative rounded-xl border border-default overflow-hidden"
    >
      <!-- Header: label + remove -->
      <div class="flex items-center gap-2 border-b border-default bg-elevated/40 px-3 py-1.5">
        <UIcon name="i-lucide-layout-template" class="size-4 text-muted" />
        <span class="text-xs font-medium text-muted">
          {{ t('pages.blockLibrary.pane.name', 'Pane Layout') }}
        </span>
        <div class="flex-1" />
        <UButton
          size="xs"
          variant="ghost"
          color="error"
          icon="i-lucide-trash-2"
          :aria-label="t('pages.blocks.deleteBlock', 'Delete block')"
          @click="deleteNode"
        />
      </div>

      <!-- Inline composer -->
      <div :style="{ height: `${height}px` }">
        <CroutonLayout v-model="layout" />
      </div>
    </div>
  </NodeViewWrapper>
</template>
