<script setup lang="ts">
/**
 * Gallery Block Editor View
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { GalleryBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: GalleryBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<GalleryBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)



const imageCount = computed(() => (attrs.value.images || []).length)
</script>

<template>
  <NodeViewWrapper data-type="gallery-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-gallery-horizontal-end"
      :label="t('pages.blockLibrary.gallery.name')"
      @delete="deleteNode"
    >

        <!-- Preview Content -->
        <div>
          <h3 v-if="attrs.title" class="text-base font-bold text-gray-900 dark:text-white mb-1">
            {{ attrs.title }}
          </h3>

          <!-- Image thumbnails preview -->
          <div v-if="imageCount > 0" class="flex gap-1 overflow-hidden rounded">
            <img
              v-for="(image, index) in (attrs.images || []).slice(0, 5)"
              :key="index"
              :src="image.src"
              :alt="image.alt || ''"
              class="h-16 w-12 object-cover rounded"
            >
            <span v-if="imageCount > 5" class="flex items-center justify-center h-16 w-12 rounded bg-gray-100 dark:bg-gray-800 text-xs text-gray-500">
              +{{ imageCount - 5 }}
            </span>
          </div>
          <span v-else class="text-xs text-gray-400 italic">
            {{ t('pages.blockViews.noImages') }}
          </span>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
