<script setup lang="ts">
/**
 * Video Block Editor View
 *
 * NodeView component for rendering video blocks in the editor.
 * Shows video preview when src is set, placeholder when empty.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { VideoBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: VideoBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<VideoBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)

const hasSrc = computed(() => !!attrs.value.src)

const isBunny = computed(() => {
  const src = attrs.value.src || ''
  return /iframe\.mediadelivery\.net/.test(src) || /\.b-cdn\.net/.test(src)
})

const bunnySrc = computed(() => {
  let url = attrs.value.src || ''
  url = url.replace('/play/', '/embed/')
  if (!url.includes('responsive=')) {
    url += (url.includes('?') ? '&' : '?') + 'responsive=true'
  }
  return url
})



</script>

<template>
  <NodeViewWrapper data-type="video-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-video"
      :label="t('pages.blocks.typeLabels.video')"
      @delete="deleteNode"
    >

        <!-- Preview Content -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
          <!-- Video preview -->
          <div v-if="hasSrc" class="relative">
            <!-- Bunny Stream iframe preview -->
            <div v-if="isBunny" class="relative w-full" style="padding-bottom: 56.25%;">
              <iframe
                :src="bunnySrc"
                class="absolute inset-0 w-full h-full pointer-events-none"
                loading="lazy"
                style="border: none;"
              />
            </div>
            <!-- Native video preview -->
            <video
              v-else
              :src="attrs.src"
              muted
              class="w-full max-h-64 object-contain"
            />
            <div v-if="attrs.caption" class="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700/50">
              {{ attrs.caption }}
            </div>
          </div>

          <!-- Empty placeholder -->
          <div
            v-else
            class="flex flex-col items-center justify-center gap-2 py-8 text-gray-400"
          >
            <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            <span class="text-sm font-medium">{{ t('pages.blocks.video.noVideo') }}</span>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
