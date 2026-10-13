<script setup lang="ts">
import type { CratePile } from '~/composables/useCrate'
import type { PileScore } from '~/composables/useCrateHints'

const props = defineProps<{ pile: CratePile, count: number, ticked: boolean, disabled: boolean, glow: PileScore | null }>()
const strong = computed(() => (props.glow?.score ?? 0) >= STRONG)
const emit = defineEmits<{ toggle: [], open: [] }>()
</script>

<template>
  <!-- One slim row inside the pile list card (kassa line-item density): tap the row to file,
       › to open the pile (any pile, so its tracks can be heard — #2221). -->
  <div class="flex min-w-0 items-center" :class="ticked ? 'bg-primary/10' : ''">
    <UButton
      :color="ticked || strong ? 'primary' : 'neutral'"
      variant="ghost"
      class="min-w-0 flex-1 justify-between rounded-none px-3 py-2"
      :disabled="disabled"
      @click="emit('toggle')"
    >
      <span class="flex min-w-0 items-center gap-2">
        <UIcon :name="ticked ? 'i-lucide-check-circle-2' : 'i-lucide-circle'" class="size-4 shrink-0" />
        <span class="truncate">{{ pile.name }}</span>
        <span v-if="glow && !ticked" class="shrink-0 truncate text-xs" :class="strong ? 'text-primary' : 'text-dimmed'">✦ {{ glow.via }}</span>
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
  </div>
</template>
