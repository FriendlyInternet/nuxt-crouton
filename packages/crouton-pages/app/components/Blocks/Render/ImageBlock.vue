<script setup lang="ts">
/**
 * Image Block Public Renderer
 *
 * Renders an image block in read-only mode with figure/figcaption.
 * Supports width presets: full, large, medium, small.
 *
 * NOTE: This component must NOT use top-level await (no async setup).
 * It is rendered via dynamic <component :is> inside BlockContent.vue
 * which has no <Suspense> boundary.
 */
import type { ImageBlockAttrs } from '../../../types/blocks'

interface Props {
  attrs: ImageBlockAttrs
}

const props = defineProps<Props>()
const { t } = useT()

const widthClass = computed(() => {
  switch (props.attrs.width) {
    case 'large': return 'max-w-[80%]'
    case 'medium': return 'max-w-[60%]'
    case 'small': return 'max-w-[40%]'
    default: return 'max-w-full'
  }
})
</script>

<template>
  <figure class="image-block" :class="[widthClass, { 'mx-auto': attrs.width && attrs.width !== 'full' }]">
    <!-- No image configured -->
    <UAlert
      v-if="!attrs.src"
      color="neutral"
      icon="i-lucide-image"
      :title="t('pages.blockRender.noImageTitle')"
      :description="t('pages.blockRender.noImageDescription')"
    />

    <!-- Render image -->
    <img
      v-else
      :src="attrs.src"
      :alt="attrs.alt || ''"
      class="rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 w-full"
    >

    <!-- Caption -->
    <figcaption
      v-if="attrs.caption"
      class="text-sm text-gray-500 dark:text-gray-400 text-center mt-2"
    >
      {{ attrs.caption }}
    </figcaption>
  </figure>
</template>
