<script setup lang="ts">
/**
 * SalesEventsGridData — the data-bound half of the events block (#2532): the card grid
 * the dashboard always showed (one card = one entry into the event workspace, #2186).
 * Async setup, so it lives behind the block's `<Suspense>` (same split as the package's
 * `CroutonLayoutCollection` / `…CollectionData`): a block is mounted by the renderer,
 * outside any page Suspense boundary.
 */
import type { SalesEvent } from '@fyit/crouton-sales/collections/events/types'

const { t } = useT()
const { teamSlug } = useTeamContext()

const { items: events, pending } = await useCollectionQuery('salesEvents') as { items: Ref<SalesEvent[]>, pending: Ref<boolean> }

const statusColor = (status?: string) => {
  switch (status) {
    case 'active': return 'success' as const
    case 'upcoming': return 'info' as const
    default: return 'neutral' as const
  }
}

const workspacePath = (event: SalesEvent) =>
  `/admin/${teamSlug.value}/sales/events/${event.slug}`
</script>

<template>
  <div>
    <div v-if="pending" class="flex justify-center p-12">
      <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-muted" />
    </div>

    <div
      v-else-if="events?.length"
      class="grid grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3 gap-4"
    >
      <!-- A real link, so the card is keyboard- and screen-reader-reachable (#2419). -->
      <NuxtLink
        v-for="event in events"
        :key="event.id"
        :to="workspacePath(event)"
        class="group block rounded-xl border border-default bg-default p-5
               transition-all duration-150 hover:border-primary/50 hover:shadow-md
               focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <div class="flex items-start justify-between gap-3">
          <h3 class="font-semibold text-lg leading-tight truncate group-hover:text-primary transition-colors">
            {{ event.title }}
          </h3>
          <UBadge :color="statusColor(event.status)" variant="subtle" size="sm">
            {{ t(`sales.events.${event.status}`, event.status) }}
          </UBadge>
        </div>

        <p class="text-muted text-sm mt-4 inline-flex items-center gap-1.5 group-hover:text-primary transition-colors">
          <UIcon name="i-lucide-arrow-right" class="size-4" aria-hidden="true" />
          {{ t('sales.events.workspace') }}
        </p>
      </NuxtLink>
    </div>

    <div v-else class="text-center text-muted p-12 border border-dashed border-default rounded-xl">
      <UIcon name="i-lucide-calendar-off" class="w-8 h-8 mx-auto mb-2" aria-hidden="true" />
      <p class="font-medium">{{ t('sales.events.noEvents') }}</p>
    </div>
  </div>
</template>
