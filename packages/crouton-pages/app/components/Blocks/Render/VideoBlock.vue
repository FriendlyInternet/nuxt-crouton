<script setup lang="ts">
/**
 * Video Block Public Renderer
 *
 * Renders a video block in read-only mode with figure/figcaption.
 * Supports width presets: full, large, medium, small.
 *
 * NOTE: This component must NOT use top-level await (no async setup).
 * It is rendered via dynamic <component :is> inside BlockContent.vue
 * which has no <Suspense> boundary.
 */
import type { VideoBlockAttrs } from '../../../types/blocks'

interface Props {
  attrs: VideoBlockAttrs
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

const isBunny = computed(() => {
  const src = props.attrs.src || ''
  return /iframe\.mediadelivery\.net/.test(src) || /\.b-cdn\.net/.test(src)
})

/** Normalize stored Bunny URL at render time and pass through playback settings */
const bunnySrc = computed(() => {
  let url = props.attrs.src || ''
  url = url.replace('/play/', '/embed/')

  const params = new URLSearchParams()
  params.set('responsive', 'true')
  if (props.attrs.autoplay) params.set('autoplay', 'true')
  if (props.attrs.loop) params.set('loop', 'true')
  if (props.attrs.muted !== false) params.set('muted', 'true')
  if (props.attrs.controls === false) params.set('controls', 'false')
  params.set('preload', 'true')

  const separator = url.includes('?') ? '&' : '?'
  return url + separator + params.toString()
})
</script>

<template>
  <figure class="video-block" :class="[widthClass, { 'mx-auto': attrs.width && attrs.width !== 'full' }]">
    <!-- No video configured -->
    <UAlert
      v-if="!attrs.src"
      color="neutral"
      icon="i-lucide-video"
      :title="t('pages.blockRender.noVideoTitle')"
      :description="t('pages.blockRender.noVideoDescription')"
    />

    <!-- Bunny Stream iframe -->
    <div v-else-if="isBunny" class="relative w-full rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden" style="padding-bottom: 56.25%;">
      <iframe
        :src="bunnySrc"
        class="absolute inset-0 w-full h-full"
        loading="lazy"
        allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture;"
        allowfullscreen
        style="border: none;"
      />
    </div>

    <!-- Native video -->
    <video
      v-else
      :src="attrs.src"
      :controls="attrs.controls !== false"
      :autoplay="attrs.autoplay || false"
      :loop="attrs.loop || false"
      :muted="attrs.muted !== false"
      playsinline
      class="rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 w-full"
    />

    <!-- Caption -->
    <figcaption
      v-if="attrs.caption"
      class="text-sm text-gray-500 dark:text-gray-400 text-center mt-2"
    >
      {{ attrs.caption }}
    </figcaption>
  </figure>
</template>
