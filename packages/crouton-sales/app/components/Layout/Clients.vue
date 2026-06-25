<script setup lang="ts">
/**
 * Layout-block wrapper: the Clients pane as a placeable pane.
 *
 * Reproduces the `clients` SplitterPanel of EventWorkspace/Shell.vue (the
 * "Klanten" pane: h-14 header, then the open-client-tabs ClientsPanel), driven
 * from a layout data tree (`croutonLayoutBlocks` id `sales-clients`) rendered
 * by CroutonLayoutRenderer — the #711 test.
 *
 * Team-scoped and recurring-clients-only, exactly like the standalone clients
 * block: gates on `loggedIn`, resolves the event by slug member-side via
 * SalesBlocksEventResolver (<Suspense>), and shows an explanatory note for a
 * non-`requiresClient` event. The renderer passes only the declared `eventSlug`
 * config through.
 */
const props = defineProps<{ eventSlug?: string }>()

const { t } = useT()
const { loggedIn } = useAuth()

const eventSlug = computed(() => props.eventSlug || '')
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <div class="h-14 shrink-0 flex items-center justify-between gap-2 px-3 bg-elevated/60 border-b border-default">
      <span class="flex items-center gap-1.5 text-sm font-medium">
        <UIcon name="i-lucide-users" class="size-4 shrink-0 text-muted" />
        {{ t('sales.workspace.clientsPanel.title') }}
      </span>
    </div>

    <div class="flex-1 overflow-y-auto p-4 pt-2">
      <!-- Team-members-only. -->
      <div
        v-if="!loggedIn"
        class="p-6 text-center text-sm text-muted"
      >
        <UIcon name="i-lucide-lock" class="w-6 h-6 mx-auto mb-2 text-muted" />
        {{ t('sales.blocks.salesClients.ui.teamOnly') }}
      </div>

      <Suspense v-else>
        <SalesBlocksEventResolver
          v-slot="{ event }"
          :event-slug="eventSlug"
          :not-found-label="t('sales.blocks.salesClients.ui.eventNotFound')"
        >
          <SalesEventWorkspaceClientsPanel v-if="event.requiresClient" :event="event" />
          <div
            v-else
            class="p-6 text-center text-sm text-muted"
          >
            <UIcon name="i-lucide-user-x" class="w-6 h-6 mx-auto mb-2 text-muted" />
            {{ t('sales.blocks.salesClients.ui.notRecurring') }}
          </div>
        </SalesBlocksEventResolver>
        <template #fallback>
          <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
        </template>
      </Suspense>
    </div>
  </div>
</template>
