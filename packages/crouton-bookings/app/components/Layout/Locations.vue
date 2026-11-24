<script setup lang="ts">
/**
 * CroutonBookingsLayoutLocations — the locations picker as an atomic layout block
 * (#924), fed by the `bookings` layout store (#3651).
 *
 * Props in, events out: it shows `locations`, marks `selectedLocations`, and a
 * click emits `toggle-location` with the id — the store turns that into the
 * shared location filter the list follows.
 *
 * Deliberately a lightweight selectable LIST rather than the native
 * `CroutonBookingsPanelMap` (#924 gap-report note): the map needs per-location
 * geo coordinates + a live maplibre instance, and the native map's value comes
 * from being wired to Panel's flyTo / focus-on-map orchestration — none of which
 * survives as a standalone pane. The list is the robust atomic equivalent; a
 * map-backed variant is a follow-up once cross-pane focus is expressible.
 */
import type { LocationData } from '../../types/booking'

const props = withDefaults(defineProps<{
  locations?: LocationData[]
  selectedLocations?: string[]
}>(), {
  locations: () => [],
  selectedLocations: () => [],
})

const emit = defineEmits<{
  'toggle-location': [id: string]
}>()

const { t } = useT()

/** Location titles may be a plain string or an i18n object ({ en, nl, ... }). */
function locName(loc: { title?: unknown }): string {
  const title = loc.title
  if (typeof title === 'string') return title
  if (title && typeof title === 'object') {
    const o = title as Record<string, string>
    return o.en ?? o.nl ?? Object.values(o)[0] ?? ''
  }
  return ''
}

function isSelected(id: string): boolean {
  return props.selectedLocations.includes(id)
}
</script>

<template>
  <div class="@container h-full overflow-auto p-2 @md:p-3 space-y-1.5">
    <p
      v-if="!locations.length"
      class="text-sm text-muted text-center p-4"
    >
      {{ t('bookings.panel.noLocations') }}
    </p>
    <button
      v-for="loc in locations"
      :key="loc.id"
      type="button"
      :aria-pressed="isSelected(loc.id)"
      class="w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors"
      :class="isSelected(loc.id)
        ? 'bg-primary/10 border-primary text-highlighted'
        : 'border-default hover:bg-elevated/60'"
      @click="emit('toggle-location', loc.id)"
    >
      <UIcon name="i-lucide-map-pin" class="size-4 shrink-0 text-muted" />
      <span class="text-sm font-medium truncate">{{ locName(loc) }}</span>
      <UIcon
        v-if="isSelected(loc.id)"
        name="i-lucide-check"
        class="size-4 shrink-0 ms-auto text-primary"
      />
    </button>
  </div>
</template>
