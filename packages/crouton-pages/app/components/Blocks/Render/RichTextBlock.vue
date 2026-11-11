<script setup lang="ts">
/**
 * Rich Text Block Public Renderer
 *
 * Renders HTML content with prose styling for public display.
 */
import type { RichTextBlockAttrs } from '../../../types/blocks'

interface Props {
  attrs: RichTextBlockAttrs
}

const props = defineProps<Props>()

const sanitizedContent = computed(() => props.attrs.content ? sanitizeHtml(props.attrs.content) : '')
</script>

<template>
  <div
    v-if="sanitizedContent"
    class="prose prose-lg dark:prose-invert max-w-none"
    v-html="sanitizedContent"
  />
</template>
