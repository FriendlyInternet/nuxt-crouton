<script setup lang="ts">
/**
 * CroutonBookingsCalendarFoldHandle
 *
 * The small chevron button under the panel calendar (#4516). In week view it
 * points down (opens the month); in month view it points up (folds to the
 * week). A tap, Enter or Space toggles.
 */
const view = defineModel<'week' | 'month'>({ required: true })

const { t } = useT()

function toggle() {
  view.value = view.value === 'month' ? 'week' : 'month'
}
</script>

<template>
  <div class="flex justify-center">
    <UButton
      color="neutral"
      variant="ghost"
      size="xs"
      :icon="view === 'month' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
      :aria-expanded="view === 'month'"
      :aria-label="t('bookings.panel.calendarHandle')"
      @click="toggle"
    />
  </div>
</template>
