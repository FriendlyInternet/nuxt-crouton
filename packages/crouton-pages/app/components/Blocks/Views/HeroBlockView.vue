<script setup lang="ts">
/**
 * Hero Block Editor View
 *
 * NodeView component for rendering hero blocks in the editor.
 * Shows a preview of the block with edit controls.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { HeroBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: HeroBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<HeroBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
// Shorthand for attrs
const attrs = computed(() => props.node.attrs)
</script>

<template>
  <NodeViewWrapper data-type="hero-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      :label="t('pages.blockLibrary.hero.name')"
      @delete="deleteNode"
    >
    <!-- Preview Content -->
    <div class="flex items-center gap-4">
      <!-- Image thumbnail -->
      <div v-if="attrs.image" class="flex-shrink-0">
        <img
          :src="attrs.image"
          :alt="attrs.title || t('pages.blockViews.heroImage')"
          class="w-16 h-16 object-cover rounded"
        />
      </div>

      <!-- Text content -->
      <div class="flex-1 min-w-0" :class="{ 'text-center': !attrs.image }">
        <p v-if="attrs.headline" class="text-xs font-medium text-primary mb-1">
          {{ attrs.headline }}
        </p>
        <h2 class="text-lg font-bold text-gray-900 dark:text-white mb-1 truncate">
          {{ attrs.title || t('pages.blockViews.heroTitle') }}
        </h2>
        <p v-if="attrs.description" class="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
          {{ attrs.description }}
        </p>
        <div v-if="attrs.links?.length" class="mt-2 flex gap-1.5" :class="{ 'justify-center': !attrs.image }">
          <span
            v-for="(link, index) in attrs.links"
            :key="index"
            class="px-2.5 py-1 bg-primary/10 text-primary rounded text-xs"
          >
            {{ link.label }}
          </span>
        </div>
      </div>
    </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
