<script setup lang="ts">
/**
 * Shared pane/slideover header: h-14 row with icon + title on the left and
 * actions + close ✕ on the right. One source for the Shell's desktop pane
 * headers, its narrow-mode slideovers, and the PaneHost deep-entry surface —
 * they must stay pixel-identical (h-14 aligns with the POS header rows, px-4
 * aligns the title with p-4 body content).
 */
defineProps<{ icon: string, title: string }>()

const emit = defineEmits<{ close: [] }>()

const { t } = useT()
</script>

<template>
  <div class="h-14 shrink-0 flex items-center justify-between gap-2 px-4 bg-elevated/60 border-b border-default">
    <span class="flex items-center gap-1.5 text-sm font-medium">
      <UIcon :name="icon" class="size-4 shrink-0 text-muted" />
      {{ title }}
    </span>
    <div class="flex items-center gap-2">
      <!-- Pane-specific actions (orders filter chip, settings Opslaan) -->
      <slot />
      <UButton
        icon="i-lucide-x"
        size="xs"
        color="neutral"
        variant="ghost"
        :aria-label="t('sales.common.close')"
        @click="emit('close')"
      />
    </div>
  </div>
</template>
