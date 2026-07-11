<script setup lang="ts">
/**
 * Standalone Orders block — public renderer.
 *
 * A drop-on-a-page orders list for one event — the same live list (filters +
 * printer-status LEDs) as the workspace's "Bestellingen" pane, but on its own
 * page so an admin can build, e.g., a dedicated kitchen-status screen.
 *
 * Team-members-only: a signed-in team member gets the list; anyone else gets a
 * hint (the orders data comes from team-scoped admin endpoints). The event is
 * resolved — and the orders fetched — only for members, inside <Suspense>:
 * SalesBlocksEventResolver and SalesEventWorkspaceOrdersTab both top-level
 * await. clientOnly — BlockContent wraps us in <ClientOnly>.
 */
interface OrdersAttrs {
  eventSlug?: string
}

const props = defineProps<{ attrs: OrdersAttrs }>()

const { t } = useT()
const { loggedIn } = useAuth()

const eventSlug = computed(() => props.attrs.eventSlug || '')
</script>

<template>
  <div class="sales-orders-block">
    <!-- Editor didn't pick an event -->
    <UAlert
      v-if="!eventSlug"
      color="neutral"
      variant="soft"
      icon="i-lucide-receipt"
      :title="t('sales.block.noEventPicked')"
    />

    <!-- Team-members-only tool: anonymous visitors don't see orders. -->
    <UAlert
      v-else-if="!loggedIn"
      color="neutral"
      variant="soft"
      icon="i-lucide-lock"
      :title="t('sales.blocks.salesOrders.ui.teamOnly')"
    />

    <!-- Signed-in team member → the live orders list. -->
    <UCard>
      <Suspense>
        <SalesBlocksEventResolver
          v-slot="{ event }"
          :event-slug="eventSlug"
          :not-found-label="t('sales.blocks.salesOrders.ui.eventNotFound')"
        >
          <SalesEventWorkspaceOrdersTab :event="event" />
        </SalesBlocksEventResolver>
        <template #fallback>
          <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
        </template>
      </Suspense>
    </UCard>
  </div>
</template>
