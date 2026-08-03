<script setup lang="ts">
/**
 * Event resolver for the standalone sales blocks (Orders, Clients).
 *
 * Resolves an event by slug from the team's events collection and hands the
 * full SalesEvent to the default scoped slot. It calls `useCollectionQuery`
 * (a team-scoped admin endpoint), so it must only be mounted for signed-in
 * team members — the block renderers gate on `useAuth().loggedIn` before
 * mounting it. Top-level await ⇒ the caller wraps it in `<Suspense>` (and the
 * slotted panels — OrdersTab / ClientsPanel — are async-setup too, so the same
 * boundary waits for both).
 */
import type { SalesEvent } from '~~/layers/sales/collections/events/types'

const props = defineProps<{
  eventSlug: string
  /** Shown when the slug doesn't resolve (event deleted / stale slug). */
  notFoundLabel: string
}>()

const { items: events } = await useCollectionQuery('salesEvents')

const event = computed(() =>
  (events.value as SalesEvent[] | null)?.find(e => e.slug === props.eventSlug)
)
</script>

<template>
  <slot v-if="event" :event="event" />
  <UAlert
    v-else
    color="neutral"
    variant="soft"
    icon="i-lucide-calendar-x"
    :title="notFoundLabel"
  />
</template>
