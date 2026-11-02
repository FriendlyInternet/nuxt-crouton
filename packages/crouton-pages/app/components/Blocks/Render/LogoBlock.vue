<script setup lang="ts">
/**
 * Logo Block Public Renderer
 *
 * Renders a logo block using Nuxt UI's UPageLogos component.
 * Uses the default slot for full control over icon/image rendering
 * and to support optional links on each logo item.
 *
 * NOTE: This component must NOT use top-level await (no async setup).
 * It is rendered via dynamic <component :is> inside BlockContent.vue
 * which has no <Suspense> boundary.
 */
import type { LogoBlockAttrs, LogoItem, LogoSize } from '../../../types/blocks'

interface Props {
  attrs: LogoBlockAttrs
}

const props = defineProps<Props>()

interface ProcessedItem {
  value: string
  alt: string
  link: string
  isIcon: boolean
}

const processedItems = computed<ProcessedItem[]>(() => {
  if (!props.attrs.items?.length) return []
  return props.attrs.items
    .filter((item: LogoItem) => item.value)
    .map((item: LogoItem) => ({
      value: item.value,
      alt: item.alt || '',
      link: item.link || '',
      isIcon: item.type === 'icon' || (!item.type && item.value?.startsWith('i-'))
    }))
})

// Use inline style for reliable sizing (avoids Tailwind/UPageLogos class conflicts)
const sizeMap: Record<LogoSize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80
}

const sizePx = computed(() => sizeMap[props.attrs.size || 'md'])

const alignClass = computed(() => {
  return props.attrs.align === 'between' ? 'justify-between' : 'justify-center'
})
</script>

<template>
  <UPageLogos
    :title="attrs.title"
    :marquee="attrs.marquee || false"
    class=""
    :ui="{ logos: `${alignClass} gap-8`, logo: '' }"
  >
    <template v-for="item in processedItems" :key="item.value">
      <NuxtLink
        v-if="item.link"
        :to="safeUrl(item.link)"
        :target="item.link.startsWith('http') ? '_blank' : undefined"
        :rel="item.link.startsWith('http') ? 'noopener noreferrer' : undefined"
        class="shrink-0"
      >
        <UIcon
          v-if="item.isIcon"
          :name="item.value"
          :style="{ width: `${sizePx}px`, height: `${sizePx}px` }"
          class="shrink-0"
        />
        <img
          v-else
          :src="item.value"
          :alt="item.alt"
          :style="{ height: `${sizePx}px` }"
          class="shrink-0 object-contain"
        >
      </NuxtLink>
      <template v-else>
        <UIcon
          v-if="item.isIcon"
          :name="item.value"
          :style="{ width: `${sizePx}px`, height: `${sizePx}px` }"
          class="shrink-0"
        />
        <img
          v-else
          :src="item.value"
          :alt="item.alt"
          :style="{ height: `${sizePx}px` }"
          class="shrink-0 object-contain"
        >
      </template>
    </template>
  </UPageLogos>
</template>
