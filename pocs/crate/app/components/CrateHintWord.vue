<script setup lang="ts">
import type { HintWord } from '~/composables/useCrateHints'

const props = defineProps<{ word: HintWord, ticked: boolean }>()
const emit = defineEmits<{ pick: [] }>()
// A word that is already a pile toggles it; any other word offers to make it a pile.
const look = computed(() => props.word.pileId
  ? { color: 'primary' as const, variant: props.ticked ? 'subtle' as const : 'ghost' as const, icon: undefined }
  : { color: 'neutral' as const, variant: 'ghost' as const, icon: 'i-lucide-plus' })
</script>

<template>
  <UButton size="xs" :color="look.color" :variant="look.variant" :trailing-icon="look.icon" class="max-w-full" @click="emit('pick')">
    <span class="truncate">{{ word.word }}</span>
  </UButton>
</template>
