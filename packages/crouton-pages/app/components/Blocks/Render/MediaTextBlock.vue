<script setup lang="ts">
/**
 * Media + Text Block Renderer
 *
 * Wide screens (md+): photo and text side by side; the photo can stay in view
 * while the text scrolls. Phones: stacked, photo first. The text is the block's
 * own child blocks, rendered by CroutonPagesBlockContent (recursion).
 *
 * Layout lives in scoped CSS rather than Tailwind classes: the consuming app's
 * Tailwind does not reliably generate classes that only appear in this package.
 */
import type { MediaTextBlockAttrs, PageBlock } from '../../../types/blocks'

const props = defineProps<{
  attrs: MediaTextBlockAttrs & { sticky?: boolean | string, frame?: boolean | string }
  /** The block's child content (passed by BlockContent for this block type only) */
  blocks?: PageBlock[]
  isFirst?: boolean
}>()

const isOn = (v: unknown, fallback: boolean) => (v === undefined || v === null ? fallback : v !== false && v !== 'false')
const sticky = computed(() => isOn(props.attrs.sticky, true))
const framed = computed(() => isOn(props.attrs.frame, true))
const imageRight = computed(() => props.attrs.side === 'right')
const doc = computed(() => ({ type: 'doc' as const, content: props.blocks || [] }))
</script>

<template>
  <div class="media-text" :class="{ 'media-text--right': imageRight, 'media-text--sticky': sticky }">
    <div v-if="attrs.src" class="media-text__media">
      <img
        :src="attrs.src"
        :alt="attrs.alt || ''"
        class="media-text__img"
        :class="{ 'media-text__img--framed': framed }"
      >
    </div>
    <div class="media-text__text">
      <CroutonPagesBlockContent :content="doc" />
    </div>
  </div>
</template>

<style scoped>
.media-text {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}
.media-text__img {
  display: block;
  width: 100%;
  height: auto;
}
.media-text__img--framed {
  border-radius: 0.75rem;
  border: 1px solid var(--ui-border);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
}
/* Paragraph rhythm inside the column: tighter than the page's block gap */
.media-text__text :deep(.block-content) {
  gap: 1.5rem;
}

@media (min-width: 768px) {
  .media-text {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: 2.5rem;
    align-items: start;
  }
  .media-text--right .media-text__media {
    order: 2;
  }
  .media-text--sticky .media-text__media {
    position: sticky;
    top: 6rem;
    align-self: start;
  }
  /* No photo: the text takes the full width */
  .media-text:not(:has(.media-text__media)) {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
