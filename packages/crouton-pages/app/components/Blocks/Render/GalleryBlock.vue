<script setup lang="ts">
/**
 * Gallery Block Public Renderer
 *
 * Expandable image gallery — images expand on hover via CSS flex transition.
 * Inspired by Inspira UI's ExpandableGallery component.
 */
import type { GalleryBlockAttrs } from '../../../types/blocks'

interface Props {
  attrs: GalleryBlockAttrs
}

const props = defineProps<Props>()
const { t } = useT()

const heightClass = computed(() => {
  const h = props.attrs.height || 'md'
  return {
    sm: 'h-60',
    md: 'h-96',
    lg: 'h-[480px]',
    xl: 'h-[600px]'
  }[h]
})
</script>

<template>
  <div class="gallery-block">
    <!-- Header -->
    <div
      v-if="attrs.headline || attrs.title || attrs.description"
      class="text-center mb-8"
    >
      <p v-if="attrs.headline" class="text-sm font-medium text-primary mb-2">
        {{ attrs.headline }}
      </p>
      <h2 v-if="attrs.title" class="text-2xl sm:text-3xl font-bold mb-4">
        {{ attrs.title }}
      </h2>
      <p v-if="attrs.description" class="text-lg text-muted max-w-2xl mx-auto">
        {{ attrs.description }}
      </p>
    </div>

    <!-- Expandable Gallery -->
    <div
      v-if="attrs.images?.length"
      class="flex w-full gap-2 overflow-hidden rounded-xl"
      :class="heightClass"
    >
      <div
        v-for="(image, index) in attrs.images"
        :key="index"
        class="gallery-item relative flex h-full flex-1 cursor-pointer overflow-hidden rounded-xl transition-all duration-500 ease-in-out hover:flex-[3]"
      >
        <img
          :src="image.src"
          :alt="image.alt || ''"
          class="h-full w-full object-cover"
        >
        <!-- Optional alt text overlay on hover -->
        <div
          v-if="image.alt"
          class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4 opacity-0 transition-opacity duration-300"
          :class="{ 'group-item-hover': true }"
        >
          <p class="text-sm text-white font-medium">{{ image.alt }}</p>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-else
      class="flex items-center justify-center rounded-xl border-2 border-dashed border-default bg-muted/20"
      :class="heightClass"
    >
      <div class="text-center text-muted">
        <UIcon name="i-lucide-images" class="size-10 mb-2 mx-auto" />
        <p class="text-sm">{{ t('pages.blockRender.noImages') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gallery-item:hover .group-item-hover {
  opacity: 1;
}
</style>
