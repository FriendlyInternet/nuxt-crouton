<script setup lang="ts">
/**
 * File Block Public Renderer
 *
 * Renders a file download button in read-only mode.
 * Styled as a bordered button with icon and label.
 *
 * NOTE: This component must NOT use top-level await (no async setup).
 * It is rendered via dynamic <component :is> inside BlockContent.vue
 * which has no <Suspense> boundary.
 */
import type { FileBlockAttrs } from '../../../types/blocks'

interface Props {
  attrs: FileBlockAttrs
}

defineProps<Props>()
const { t } = useT()
</script>

<template>
  <div class="file-block">
    <!-- No file configured -->
    <UAlert
      v-if="!attrs.file"
      color="neutral"
      icon="i-lucide-file"
      :title="t('pages.blockRender.noFileTitle')"
      :description="t('pages.blockRender.noFileDescription')"
    />

    <!-- Render download button -->
    <a
      v-else
      :href="attrs.file"
      download
      class="inline-flex items-center gap-2.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg)] px-5 py-3 text-sm font-medium text-[var(--ui-text)] shadow-sm transition-colors hover:bg-[var(--ui-bg-elevated)] hover:border-[var(--ui-border-hover)]"
    >
      <UIcon :name="attrs.icon || 'i-lucide-download'" class="size-4.5 shrink-0" />
      <span>{{ attrs.label || t('pages.blockRender.downloadFile') }}</span>
    </a>
  </div>
</template>
