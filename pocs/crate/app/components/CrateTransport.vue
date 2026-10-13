<script setup lang="ts">
defineProps<{ hasAudio: boolean, canNext: boolean }>()
const emit = defineEmits<{ skip: [seconds: number], next: [] }>()
</script>

<template>
  <div class="flex shrink-0 items-center gap-1">
    <UFieldGroup size="sm">
      <UButton icon="i-lucide-rotate-ccw" color="neutral" variant="soft" aria-label="Back 15 seconds" :disabled="!hasAudio" @click="emit('skip', -15)" />
      <UButton icon="i-lucide-rotate-cw" color="neutral" variant="soft" aria-label="Forward 15 seconds" :disabled="!hasAudio" @click="emit('skip', 15)" />
    </UFieldGroup>
    <UButton size="sm" trailing-icon="i-lucide-arrow-right" label="Next" :variant="canNext ? 'solid' : 'soft'" @click="emit('next')" />
  </div>
</template>
