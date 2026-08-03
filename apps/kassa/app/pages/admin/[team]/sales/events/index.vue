<script setup lang="ts">
/**
 * Fanfare Events Dashboard
 *
 * Grid of event cards. Clicking a card opens the event workspace
 * (products / orders / printers / settings tabs from crouton-sales);
 * each card also exposes the POS ("Kassa openen") and the edit form.
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

const orderPath = (event: SalesEvent) =>
  `/admin/${teamSlug.value}/sales/events/${event.slug}/order`
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

        <div class="flex items-center gap-2 mt-4">
          <UButton
            icon="i-lucide-store"
            size="sm"
            color="primary"
            variant="soft"
            :label="t('sales.events.openPos')"
            @click.stop="navigateTo(orderPath(event))"
          />
          <UButton
            icon="i-lucide-layout-dashboard"
            size="sm"
            color="neutral"
            variant="ghost"
            :label="t('sales.events.workspace')"
            @click.stop="navigateTo(workspacePath(event))"
          />
        </div>
      </div>
    </div>

    <div v-else class="text-center text-muted p-12 border border-dashed border-default rounded-xl">
      <UIcon name="i-lucide-calendar-off" class="w-8 h-8 mx-auto mb-2" />
      <p class="font-medium">{{ t('sales.events.noEvents') }}</p>
    </div>
  </div>
</template>
