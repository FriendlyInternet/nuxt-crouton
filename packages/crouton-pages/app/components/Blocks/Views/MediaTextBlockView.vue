<script setup lang="ts">
/**
 * Media + Text Block Editor View
 *
 * The photo (set via the block's property panel, like the image block) beside
 * the block's own editable content (NodeViewContent). Clicks inside the text are
 * kept away from the frame, so editing text never opens the settings panel.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3'
import type { MediaTextBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: MediaTextBlockAttrs }
  selected: boolean
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)
const imageRight = computed(() => attrs.value.side === 'right')
</script>

<template>
  <NodeViewWrapper data-type="media-text-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-panel-left"
      :label="t('pages.blockLibrary.mediaText.name', 'Image + text')"
      @delete="deleteNode"
    >
      <div class="media-text-editor" :class="{ 'media-text-editor--right': imageRight }">
        <!-- Photo (edit via the pencil / property panel) -->
        <div class="media-text-editor__media" contenteditable="false">
          <img
            v-if="attrs.src"
            :src="attrs.src"
            :alt="attrs.alt || ''"
            class="w-full rounded-lg object-cover"
          >
          <div
            v-else
            class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-default py-10 text-muted"
          >
            <UIcon name="i-lucide-image" class="size-7" />
            <span class="text-xs">{{ t('pages.blocks.noImage') }}</span>
          </div>
        </div>

        <!-- Editable text: stop clicks reaching the frame (which opens the settings) -->
        <div class="media-text-editor__text" @click.stop @dblclick.stop>
          <NodeViewContent class="media-text-editor__content" />
        </div>
      </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>

<style scoped>
.media-text-editor {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  gap: 1rem;
  align-items: start;
}
.media-text-editor--right {
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
}
.media-text-editor--right .media-text-editor__media {
  order: 2;
}
.media-text-editor__text {
  min-width: 0;
  cursor: text;
  border-left: 2px solid var(--ui-border);
  padding-left: 0.75rem;
}
.media-text-editor--right .media-text-editor__text {
  border-left: 0;
  border-right: 2px solid var(--ui-border);
  padding-left: 0;
  padding-right: 0.75rem;
}
</style>
