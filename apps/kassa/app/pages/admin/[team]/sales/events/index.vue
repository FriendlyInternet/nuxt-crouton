<script setup lang="ts">
/**
 * Fanfare Events Dashboard
 *
 * Grid of event cards. Clicking a card opens the ONE event-workspace
 * experience (the adaptive block: kassa + orders / clients / data / settings).
 * No separate "Kassa openen" vs "Werkruimte" split anymore — the card is the
 * single entry, and the block's own "Open kassa" reaches the POS (#2186).
 *
 * @route /admin/[team]/sales/events
 */
import type { SalesEvent } from '~~/layers/sales/collections/events/types'

definePageMeta({ middleware: ['auth'] })

const { t } = useT()
const { teamSlug } = useTeamContext()
const crouton = useCrouton()

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
  <div class="p-6 space-y-6">
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">{{ t('sales.events.title') }}</h1>
        <p class="text-muted text-sm mt-1">{{ t('sales.events.description') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <CroutonImportButton collection="salesEvents" />
        <UButton
          color="primary"
          icon="i-lucide-plus"
          :label="t('common.create')"
          @click="crouton.open('create', 'salesEvents')"
        />
      </div>
    </div>

    <div v-if="pending" class="flex justify-center p-12">
      <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-muted" />
    </div>

    <div
      v-else-if="events?.length"
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <div
        v-for="event in events"
        :key="event.id"
        role="link"
        class="group rounded-xl border border-default bg-default p-5 cursor-pointer
               transition-all duration-150 hover:border-primary/50 hover:shadow-md"
        @click="navigateTo(workspacePath(event))"
      >
        <div class="flex items-start justify-between gap-3">
          <h3 class="font-semibold text-lg leading-tight truncate group-hover:text-primary transition-colors">
            {{ event.title }}
          </h3>
          <UBadge :color="statusColor(event.status)" variant="subtle" size="sm">
            {{ t(`sales.events.${event.status}`, event.status) }}
          </UBadge>
        </div>

        <!-- One entry: the card click opens the unified workspace (#2186).
             The block's own "Open kassa" reaches the POS from there — no
             separate "Kassa openen" shortcut, no "Werkruimte" duplicate. -->
        <p class="text-muted text-sm mt-4 inline-flex items-center gap-1.5 group-hover:text-primary transition-colors">
          <UIcon name="i-lucide-arrow-right" class="size-4" />
          {{ t('sales.events.workspace') }}
        </p>
      </div>
    </div>

    <div v-else class="text-center text-muted p-12 border border-dashed border-default rounded-xl">
      <UIcon name="i-lucide-calendar-off" class="w-8 h-8 mx-auto mb-2" />
      <p class="font-medium">{{ t('sales.events.noEvents') }}</p>
    </div>
  </div>
</template>
