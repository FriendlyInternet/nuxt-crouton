<script setup lang="ts">
/**
 * CroutonBookingsLayoutCalendar — the bookings calendar as a placeable layout
 * block (Sprint 4, #709). The compound surface the deterministic layout pass
 * reaches for when a bookings collection is present → a "calendar-primary"
 * arrangement.
 *
 * Thin wrapper over `CroutonBookingsPanel` (which self-fetches its bookings /
 * locations / settings via `useBookingsList` when no data prop is passed), giving
 * it a pane-sized, container-responsive shell. Registered in `croutonLayoutBlocks`
 * with a wide `minWidth` so the viability gate keeps it in a roomy pane.
 */
withDefaults(defineProps<{
  /** Carried for registry symmetry with the data blocks; the panel is team-scoped here. */
  collection?: string
  scope?: 'personal' | 'team'
}>(), { scope: 'team' })
</script>

<template>
  <div class="@container h-full overflow-auto">
    <CroutonBookingsPanel :scope="scope" />
  </div>
</template>
