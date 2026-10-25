<script setup lang="ts">
/**
 * BoardSheetHidden — every block hidden at this width, with Settings (select
 * it so its recipe can be edited — it has no pane to tap any more) and Show.
 */
import { collapsePlacement, collapseReveal, type HiddenItem } from '~/utils/board-hidden'

defineProps<{ items: HiddenItem[] }>()
const emit = defineEmits<{ select: [item: HiddenItem], show: [blockId: string] }>()
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs uppercase tracking-wide text-muted">Hidden at this width</p>
    <div v-for="item in items" :key="item.blockId" class="flex items-center gap-2" :data-hidden-row="item.blockId">
      <UIcon :name="item.icon" class="size-4 shrink-0" />
      <span class="min-w-0 flex-1 truncate text-sm">{{ item.label }}</span>
      <span class="text-xs text-muted">{{ collapsePlacement(item.recipe) === 'nav' ? 'nav' : item.recipe.edge }} · {{ collapseReveal(item.recipe) }}</span>
      <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-settings-2" aria-label="Settings" @click="emit('select', item)" />
      <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-eye" label="Show" @click="emit('show', item.blockId)" />
    </div>
  </div>
</template>
