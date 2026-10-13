<script setup lang="ts">
defineProps<{ hasAudio: boolean, canNext: boolean }>()
const emit = defineEmits<{ prev: [], skip: [seconds: number], list: [], next: [] }>()
</script>

<template>
  <!-- Grouped like kassa's quantity stepper: one control, themed as a unit. -->
  <div class="flex items-center justify-between gap-2 pt-0.5">
    <UFieldGroup size="sm">
      <UButton icon="i-lucide-skip-back" color="neutral" variant="soft" aria-label="Previous track" @click="emit('prev')" />
      <UButton icon="i-lucide-rotate-ccw" color="neutral" variant="soft" aria-label="Back 15 seconds" :disabled="!hasAudio" @click="emit('skip', -15)" />
      <UButton icon="i-lucide-rotate-cw" color="neutral" variant="soft" aria-label="Forward 15 seconds" :disabled="!hasAudio" @click="emit('skip', 15)" />
      <UButton icon="i-lucide-list-music" color="neutral" variant="soft" aria-label="Track list" @click="emit('list')" />
    </UFieldGroup>
    <UButton size="sm" trailing-icon="i-lucide-arrow-right" label="Next" :variant="canNext ? 'solid' : 'soft'" @click="emit('next')" />
  </div>
</template>
