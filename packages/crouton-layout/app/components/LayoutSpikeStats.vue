<script setup lang="ts">
/**
 * CroutonLayoutSpikeStats — a throwaway "stats block" for the layout spike (#713).
 * Real Nuxt UI cards, responsive to its pane via container queries.
 */
const stats = [
  { label: 'Bookings', value: '128', icon: 'i-lucide-calendar-check' },
  { label: 'Revenue', value: '€4.2k', icon: 'i-lucide-euro' },
  { label: 'Customers', value: '54', icon: 'i-lucide-users' },
  { label: 'Occupancy', value: '78%', icon: 'i-lucide-gauge' },
]
</script>

<template>
  <div class="@container h-full overflow-auto p-4">
    <div class="grid grid-cols-1 @sm:grid-cols-2 gap-3">
      <UCard
        v-for="s in stats"
        :key="s.label"
      >
        <div class="flex items-center gap-3">
          <UIcon :name="s.icon" class="size-6 text-primary" />
          <div>
            <p class="text-xs text-muted">{{ s.label }}</p>
            <p class="text-lg font-semibold">{{ s.value }}</p>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
