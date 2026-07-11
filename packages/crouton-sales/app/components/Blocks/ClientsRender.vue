<script setup lang="ts">
/**
 * Standalone Clients block — public renderer.
 *
 * A drop-on-a-page list of an event's open client tabs — the same view as the
 * workspace's "Klanten" pane (active clients with an open tab, each with the
 * two-step settle / print-receipt action) — on its own page.
 *
 * Team-members-only: a signed-in team member gets the list; anyone else gets a
 * hint (the data comes from team-scoped admin endpoints). Like the pane, it
 * only applies to recurring-client events (`requiresClient`); a member on a
 * non-recurring event gets an explanatory note. The event is resolved member-
 * side via the shared SalesBlocksEventResolver inside <Suspense>. clientOnly —
 * BlockContent wraps us in <ClientOnly>.
 */
interface ClientsAttrs {
  eventSlug?: string
}

const props = defineProps<{ attrs: ClientsAttrs }>()

const { t } = useT()
const { loggedIn } = useAuth()

const eventSlug = computed(() => props.attrs.eventSlug || '')
</script>

<template>
  <div class="sales-clients-block">
    <!-- Editor didn't pick an event -->
    <UAlert
      v-if="!eventSlug"
      color="neutral"
      variant="soft"
      icon="i-lucide-users"
      :title="t('sales.block.noEventPicked')"
    />

    <!-- Team-members-only tool. -->
    <UAlert
      v-else-if="!loggedIn"
      color="neutral"
      variant="soft"
      icon="i-lucide-lock"
      :title="t('sales.blocks.salesClients.ui.teamOnly')"
    />

    <!-- Signed-in team member → the open client tabs (recurring-client events). -->
    <UCard>
      <Suspense>
        <SalesBlocksEventResolver
          v-slot="{ event }"
          :event-slug="eventSlug"
          :not-found-label="t('sales.blocks.salesClients.ui.eventNotFound')"
        >
          <SalesEventWorkspaceClientsPanel v-if="event.requiresClient" :event="event" />
          <UAlert
            v-else
            color="neutral"
            variant="soft"
            icon="i-lucide-user-x"
            :title="t('sales.blocks.salesClients.ui.notRecurring')"
          />
        </SalesBlocksEventResolver>
        <template #fallback>
          <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
        </template>
      </Suspense>
    </UCard>
  </div>
</template>
