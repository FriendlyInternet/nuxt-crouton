<script setup lang="ts">
defineProps<{ hasAudio: boolean, canNext: boolean, checked: boolean }>()
const emit = defineEmits<{ skip: [seconds: number], next: [], done: [] }>()
</script>

<template>
  <div class="flex shrink-0 items-center gap-1">
    <UFieldGroup size="sm">
      <UButton icon="i-lucide-rotate-ccw" color="neutral" variant="soft" aria-label="Back 15 seconds" :disabled="!hasAudio" @click="emit('skip', -15)" />
      <UButton icon="i-lucide-rotate-cw" color="neutral" variant="soft" aria-label="Forward 15 seconds" :disabled="!hasAudio" @click="emit('skip', 15)" />
    </UFieldGroup>
    <UButton size="sm" icon="i-lucide-check" label="Done" :color="checked ? 'success' : 'primary'" :variant="canNext || checked ? 'solid' : 'soft'" :aria-label="checked ? 'Checked in crate — next track' : 'Mark as checked and go to the next track'" @click="emit('done')" />
    <UButton size="sm" icon="i-lucide-arrow-right" color="neutral" variant="soft" aria-label="Next track (skip)" @click="emit('next')" />
  </div>
</template>
