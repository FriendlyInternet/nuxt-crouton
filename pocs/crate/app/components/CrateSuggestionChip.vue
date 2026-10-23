<script setup lang="ts">
import type { CratePile } from '~/composables/useCrate'

// Tap = file the track into the pile. Hold = open a sheet with the pile's tracks; let go =
// start the samples (#2221). Sound starts on release because iOS only allows audio from a
// touch event, and the hold itself fires from a timer.
defineProps<{ pile: CratePile, title: string }>()
const emit = defineEmits<{ file: [], hold: [], release: [] }>()

const el = useTemplateRef<HTMLElement>('el')
const held = ref(false)
onLongPress(el, () => {
  held.value = true
  emit('hold')
}, {
  delay: 450,
  distanceThreshold: 12, // a sideways swipe of the row isn't a hold
  onMouseUp: (_duration, _distance, isLongPress) => { if (isLongPress) emit('release') }
})
function onClick() {
  // The click that follows a hold's release must not also file the track.
  if (held.value) held.value = false
  else emit('file')
}
</script>

<template>
  <span ref="el" class="shrink-0 select-none [-webkit-touch-callout:none]">
    <UButton size="sm" :variant="held ? 'solid' : 'soft'" :title="title" @click="onClick">
      {{ pile.name }}
    </UButton>
  </span>
</template>
