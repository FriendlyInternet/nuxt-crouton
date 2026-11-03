<script setup lang="ts">
/**
 * Embed Block Public Renderer
 *
 * Renders an embed block in read-only mode using an <iframe>.
 * Supports YouTube, Figma, and generic URL embeds.
 * Auto-detects provider from URL and transforms to the correct embed URL.
 *
 * NOTE: This component must NOT use top-level await (no async setup).
 * It is rendered via dynamic <component :is> inside BlockContent.vue
 * which has no <Suspense> boundary.
 */
import type { EmbedBlockAttrs } from '../../../types/blocks'

interface Props {
  attrs: EmbedBlockAttrs
}

const props = defineProps<Props>()
const { t } = useT()

function extractYouTubeId(url: string): string | null {
  // Handle youtu.be/ID
  const shortMatch = url.match(/youtu\.be\/([^?&]+)/)
  if (shortMatch) return shortMatch[1] ?? null
  // Handle youtube.com/watch?v=ID
  const longMatch = url.match(/[?&]v=([^&]+)/)
  if (longMatch) return longMatch[1] ?? null
  // Handle youtube.com/embed/ID
  const embedMatch = url.match(/youtube\.com\/embed\/([^?&]+)/)
  if (embedMatch) return embedMatch[1] ?? null
  return null
}

const embedUrl = computed(() => {
  const url = props.attrs.url || ''
  if (!url) return ''

  // YouTube
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    const id = extractYouTubeId(url)
    return id ? `https://www.youtube.com/embed/${id}` : url
  }

  // Figma
  if (url.includes('figma.com')) {
    return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}`
  }

  // Generic / custom
  return url
})

const height = computed(() => {
  const v = props.attrs.height
  return typeof v === 'number' ? v : parseInt(String(v), 10) || 400
})
</script>

<template>
  <figure class="embed-block">
    <!-- No URL configured -->
    <UAlert
      v-if="!attrs.url"
      color="neutral"
      icon="i-lucide-youtube"
      :title="t('pages.blockRender.noUrlTitle')"
      :description="t('pages.blockRender.noUrlDescription')"
    />

    <!-- Render iframe -->
    <iframe
      v-else
      :src="embedUrl"
      :height="height"
      width="100%"
      class="rounded-xl border border-gray-200 dark:border-gray-700 w-full"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
      sandbox="allow-scripts allow-popups allow-forms"
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
