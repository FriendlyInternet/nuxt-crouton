# @fyit/crouton-calendar

Swipeable week strip and month grid for Nuxt Crouton apps. Opt-in addon layer: it owns the swipe/slide behaviour and the layout; **you** supply what each day shows through the `#day` slot.

> Not to be confused with crouton-core's `CroutonCalendar` date picker.

## Install

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@fyit/crouton-core', '@fyit/crouton-calendar']
})
```

## Components

| Component | Purpose |
|-----------|---------|
| `CroutonCalendarWeek` | Swipeable week strip. Slots `#day`, `#day-action`. Emits `select`. |
| `CroutonCalendarMonth` | Swipeable month grid. Slot `#day` (`neighbour` is true for the prev/next panels). Emits `select`. |

## Demo: your own day content

```vue
<script setup lang="ts">
const events = { '2026-10-27': 2, '2026-10-29': 1 } // date → count
const key = (d: Date) => d.toLocaleDateString('en-CA')
const picked = ref<Date | null>(null)
</script>

<template>
  <CroutonCalendarWeek @select="picked = $event">
    <template #day="{ jsDate }">
      <div class="mt-1 flex justify-center gap-0.5">
        <span v-for="n in events[key(jsDate)] ?? 0" :key="n" class="size-1.5 rounded-full bg-primary" />
      </div>
    </template>
  </CroutonCalendarWeek>

  <CroutonCalendarMonth @select="picked = $event">
    <template #day="{ day, jsDate, neighbour }">
      <span>{{ day.day }}</span>
      <span v-if="!neighbour && events[key(jsDate)]" class="size-1 rounded-full bg-primary" />
    </template>
  </CroutonCalendarMonth>
</template>
```

The `Week` component exposes `goToDate(date)` and `goToToday()` via a template ref.

## Used by

`@fyit/crouton-bookings` extends this layer; detect it from other packages with `useCroutonApps().hasApp('calendar')`.
