<script setup lang="ts">
/**
 * CroutonBookingsCalendarFoldHandle
 *
 * The small bar under the panel calendar (#4516). Drag it up to fold the
 * month to a week, drag it down to unfold it; a tap, Enter or Space toggles.
 */
const view = defineModel<'week' | 'month'>({ required: true })

const { t } = useT()

const handleEl = ref<HTMLElement | null>(null)

// A pointer drag can be followed by a click; that click must not undo the drag
let dragged = false

// usePointerSwipe sets an inline `touch-action: pan-y` on its target, so the
// template uses `touch-none!` (important) to keep the page from scrolling.
usePointerSwipe(handleEl, {
  threshold: 16,
  onSwipeStart() {
    dragged = false
  },
  onSwipeEnd(_e: PointerEvent, dir: string) {
    if (dir === 'up') {
      view.value = 'week'
      dragged = true
    }
    else if (dir === 'down') {
      view.value = 'month'
      dragged = true
    }
  },
})

function onClick(e: MouseEvent) {
  // keyboard clicks (detail 0) always toggle
  if (dragged && e.detail !== 0) {
    dragged = false
    return
  }
  view.value = view.value === 'month' ? 'week' : 'month'
}
</script>

<template>
  <div ref="handleEl" class="flex justify-center touch-none!">
    <UButton
      color="neutral"
      variant="ghost"
      size="xs"
      class="h-6 w-16 justify-center"
      :aria-expanded="view === 'month'"
      :aria-label="t('bookings.panel.calendarHandle')"
      @click="onClick"
    >
      <span class="h-1 w-8 rounded-full bg-accented" />
    </UButton>
  </div>
</template>
