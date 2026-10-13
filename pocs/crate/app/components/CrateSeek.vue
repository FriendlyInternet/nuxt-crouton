<script setup lang="ts">
defineProps<{ position: number, duration: number }>()
const emit = defineEmits<{ seek: [seconds: number] }>()
const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
</script>

<template>
  <div class="flex items-center gap-2 text-xs tabular-nums text-muted">
    <span>{{ time(position) }}</span>
    <USlider :model-value="position" :max="duration || 1" :step="1" size="xs" class="flex-1" @update:model-value="(v) => v !== undefined && emit('seek', v)" />
    <span>{{ time(duration) }}</span>
  </div>
</template>
