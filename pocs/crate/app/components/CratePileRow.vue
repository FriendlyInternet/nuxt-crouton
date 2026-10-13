<script setup lang="ts">
import type { CratePile } from '~/composables/useCrate'
import type { PileScore } from '~/composables/useCrateHints'

const props = defineProps<{ pile: CratePile, count: number, ticked: boolean, canOpen: boolean, disabled: boolean, glow: PileScore | null }>()
const strong = computed(() => (props.glow?.score ?? 0) >= STRONG)
const emit = defineEmits<{ toggle: [], open: [] }>()
</script>

<template>
  <div class="flex min-w-0 items-stretch gap-1">
    <UButton
      block
      :variant="ticked ? 'subtle' : 'outline'"
      :color="ticked || strong ? 'primary' : 'neutral'"
      class="min-w-0 flex-1 justify-between py-2.5"
      :disabled="disabled"
      @click="emit('toggle')"
    >
      <span class="flex min-w-0 items-center gap-2">
        <UIcon :name="ticked ? 'i-lucide-check-circle-2' : 'i-lucide-circle'" class="size-4 shrink-0" />
        <span class="truncate">{{ pile.name }}</span>
        <span v-if="glow && !ticked" class="shrink-0 truncate text-xs" :class="strong ? 'text-primary' : 'text-dimmed'">✦ via {{ glow.via }}</span>
      </span>
      <span class="shrink-0 text-xs tabular-nums text-muted">{{ count }}</span>
    </UButton>
    <UButton
      v-if="canOpen"
      icon="i-lucide-chevron-right"
      variant="ghost"
      color="neutral"
      :aria-label="`Open ${pile.name}`"
      @click="emit('open')"
    />
  </div>
</template>
