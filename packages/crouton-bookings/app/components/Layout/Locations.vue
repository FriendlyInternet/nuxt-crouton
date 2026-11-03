<script setup lang="ts">
/**
 * CroutonBookingsLayoutLocations — the locations picker as an atomic layout block
 * (#924). Self-fetches locations and toggles selection into the shared filter
 * store, so picking a location here filters the sibling list/calendar blocks.
 *
 * Deliberately a lightweight selectable LIST rather than the native
 * `CroutonBookingsPanelMap` (#924 gap-report note): the map needs per-location
 * geo coordinates + a live maplibre instance, and the native map's value comes
 * from being wired to Panel's flyTo / focus-on-map orchestration — none of which
 * survives as a standalone pane. The list is the robust atomic equivalent; a
 * map-backed variant is a follow-up once cross-pane focus is expressible.
 */
const props = withDefaults(defineProps<{
  scope?: 'personal' | 'team'
}>(), { scope: 'team' })

const { t } = useT()
const { locations } = useBookingsList({ scope: props.scope })
const { filters, toggleLocation } = useBookingsLayoutFilters()

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
  return filters.value.locations.includes(id)
}
</script>

<template>
  <div class="@container h-full overflow-auto p-2 @md:p-3 space-y-1.5">
    <p
      v-if="!(locations && locations.length)"
      class="text-sm text-muted text-center p-4"
    >
      {{ t('bookings.panel.noLocations') }}
    </p>
    <button
      v-for="loc in locations ?? []"
      :key="loc.id"
      type="button"
      :aria-pressed="isSelected(loc.id)"
      class="w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors"
      :class="isSelected(loc.id)
        ? 'bg-primary/10 border-primary text-highlighted'
        : 'border-default hover:bg-elevated/60'"
      @click="toggleLocation(loc.id)"
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
