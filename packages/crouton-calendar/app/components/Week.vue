<script setup lang="ts">
/**
 * CroutonCalendarWeek — placeholder for the swipeable week view.
 * Overrides the crouton-core stub when this layer is extended; the real
 * implementation lands in a follow-up (epic #2574).
 */
defineProps<{
  modelValue?: string
}>()
</script>

<template>
  <div data-calendar-week />
</template>
