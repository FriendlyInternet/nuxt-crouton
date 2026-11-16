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
  // items can arrive as a JSON string from the live editor (collab/HTML round
  // trip) — accept that, and never crash on anything that isn't a list.
  let items: unknown = props.attrs.items
  if (typeof items === 'string') {
    try { items = JSON.parse(items) } catch { items = [] }
  }
  if (!Array.isArray(items) || !items.length) return []
  return (items as LogoItem[])
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
    :ui="{ logos: `${alignClass} flex-wrap gap-x-8 gap-y-6`, logo: '' }"
  >
    <template v-for="item in processedItems" :key="item.value">
      <NuxtLink
        v-if="item.link"
        :to="safeUrl(item.link)"
        :target="item.link.startsWith('http') ? '_blank' : undefined"
        :rel="item.link.startsWith('http') ? 'noopener noreferrer' : undefined"
        class="min-w-0 max-w-full"
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
          class="max-w-full object-contain"
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
          class="max-w-full object-contain"
        >
      </template>
    </template>
  </UPageLogos>
</template>
