<script setup lang="ts">
/**
 * CroutonBookingsCalendarFoldHandle
 *
 * The icon-only month ↔ week toggle at the left end of the panel calendar's
 * label row (#4516), mirroring the close X on the right. In week view it shows
 * `calendar-days` (tap → month); in month view `calendar-minus` (tap → week).
 * A tap, Enter or Space toggles.
 */
const view = defineModel<'week' | 'month'>({ required: true })

const { t } = useT()

function toggle() {
  view.value = view.value === 'month' ? 'week' : 'month'
}
</script>

<template>
  <UButton
    color="neutral"
    variant="ghost"
    size="sm"
    :icon="view === 'month' ? 'i-lucide-calendar-minus' : 'i-lucide-calendar-days'"
    :aria-expanded="view === 'month'"
    :aria-label="t('bookings.panel.calendarHandle')"
    @click="toggle"
  />
</template>
