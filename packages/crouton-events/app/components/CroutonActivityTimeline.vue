<script setup lang="ts">
import type { CroutonEvent, DateGroup } from '../types/events'

const props = withDefaults(defineProps<{
  events: CroutonEvent[]
  loading?: boolean
  emptyMessage?: string
}>(), {
  events: () => [],
  loading: false,
  emptyMessage: 'No activity found'
})

const emit = defineEmits<{
  eventClick: [event: CroutonEvent]
}>()

// Track expanded events
const expandedEvents = ref<Set<string>>(new Set())

function toggleExpand(event: CroutonEvent) {
  if (expandedEvents.value.has(event.id)) {
    expandedEvents.value.delete(event.id)
  } else {
    expandedEvents.value.add(event.id)
  }
}

function isExpanded(event: CroutonEvent): boolean {
  return expandedEvents.value.has(event.id)
}

// Group events by date
const groupedEvents = computed<DateGroup[]>(() => {
  if (!props.events?.length) return []

  const groups = new Map<string, CroutonEvent[]>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  props.events.forEach((event) => {
    const eventDate = new Date(event.timestamp)
    eventDate.setHours(0, 0, 0, 0)

    let label: string
    const dateKey = eventDate.toISOString().split('T')[0]!

    if (eventDate.getTime() === today.getTime()) {
      label = 'Today'
    } else if (eventDate.getTime() === yesterday.getTime()) {
      label = 'Yesterday'
    } else {
      label = eventDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      })
    }

    if (!groups.has(dateKey)) {
      groups.set(dateKey, [])
    }
    groups.get(dateKey)!.push(event)
  })

  // Convert to array and sort by date (newest first)
  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, events]) => {
      const eventDate = new Date(date)
      eventDate.setHours(0, 0, 0, 0)

      let label: string
      if (eventDate.getTime() === today.getTime()) {
        label = 'Today'
      } else if (eventDate.getTime() === yesterday.getTime()) {
        label = 'Yesterday'
      } else {
        label = eventDate.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric'
        })
      }

      return {
        label,
        date,
        events: events.sort((a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
      }
    })
})
</script>

<template>
  <div class="crouton-activity-timeline">
    <!-- Loading state -->
    <div
      v-if="loading"
      class="flex items-center justify-center py-12"
    >
      <div class="flex items-center gap-2 text-muted">
        <UIcon
          name="i-lucide-loader-2"
          class="size-5 animate-spin"
        />
        <span>Loading activity...</span>
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!events?.length"
      class="flex flex-col items-center justify-center py-12 text-center"
    >
      <div class="rounded-full bg-muted/30 p-4 mb-4">
        <UIcon
          name="i-lucide-activity"
          class="size-8 text-muted"
        />
      </div>
      <p class="text-muted">{{ emptyMessage }}</p>
    </div>

    <!-- Timeline -->
    <div
      v-else
      class="space-y-6"
    >
      <div
        v-for="group in groupedEvents"
        :key="group.date"
        class="space-y-1"
      >
        <!-- Date header -->
        <div class="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 px-2 -mx-2">
          <div class="flex items-center gap-2">
            <div class="h-px flex-1 bg-border" />
            <span class="text-xs font-medium text-muted uppercase tracking-wider">
              {{ group.label }}
            </span>
            <div class="h-px flex-1 bg-border" />
          </div>
        </div>

        <!-- Events -->
        <div class="space-y-0">
          <CroutonActivityTimelineItem
            v-for="event in group.events"
            :key="event.id"
            :event="event"
            :expanded="isExpanded(event)"
            @click="emit('eventClick', event)"
            @toggle-expand="toggleExpand"
          />
        </div>
      </div>
    </div>
  </div>
</template>
