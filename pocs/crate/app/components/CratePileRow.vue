<script setup lang="ts">
import type { CratePile } from '~/composables/useCrate'
import type { PileScore } from '~/composables/useCrateHints'

const props = defineProps<{
  pile: CratePile
  count: number
  ticked: boolean
  disabled: boolean
  glow: PileScore | null
  editing?: boolean
  /** It has sub-piles: holding a dragged track over it opens it (#2210). */
  springs?: boolean
  /** A dragged track is over this row; `spring` (0..1) fills the bar along its bottom. */
  dropOver?: boolean
  spring?: number
}>()
const strong = computed(() => (props.glow?.score ?? 0) >= STRONG)
const emit = defineEmits<{ toggle: [], open: [] }>()
</script>

<template>
  <!-- One slim row inside the pile list card (kassa line-item density): tap the row to file,
       › to open the pile (any pile, so its tracks can be heard — #2221). -->
  <div
    class="relative flex min-w-0 items-center transition-colors"
    :class="dropOver ? 'bg-primary/20 ring-2 ring-inset ring-primary' : ticked && !editing ? 'bg-primary/10' : ''"
    :data-drop-pile="pile.id"
    :data-springs="springs ? '' : undefined"
  >
    <UButton
      :color="!editing && (ticked || strong) ? 'primary' : 'neutral'"
      variant="ghost"
      class="min-w-0 flex-1 justify-between rounded-none px-3 py-2"
      :disabled="disabled && !editing"
      @click="emit('toggle')"
    >
      <span class="flex min-w-0 items-center gap-2">
        <UIcon :name="editing ? 'i-lucide-pencil' : ticked ? 'i-lucide-check-circle-2' : 'i-lucide-circle'" class="size-4 shrink-0" />
        <span class="truncate">{{ pile.name }}</span>
        <span v-if="glow && !ticked && !editing" class="shrink-0 truncate text-xs" :class="strong ? 'text-primary' : 'text-dimmed'">✦ {{ glow.via }}</span>
      </span>
      <span class="shrink-0 text-xs tabular-nums text-muted">{{ count }}</span>
    </UButton>
    <UButton
      icon="i-lucide-chevron-right"
      size="sm"
      variant="ghost"
      color="neutral"
      class="me-1"
      :aria-label="`Open ${pile.name}`"
      @click="emit('open')"
    />
    <div v-if="dropOver && springs" class="absolute inset-x-0 bottom-0 h-1 bg-primary/20" aria-hidden="true">
      <div class="h-full bg-primary" :style="{ width: `${Math.round((spring ?? 0) * 100)}%` }" />
    </div>
  </div>
</template>
