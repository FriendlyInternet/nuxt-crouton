<script setup lang="ts">
/**
 * Linked devices (#806): link a till with a one-time pairing code, list the
 * team's tills and print routers with each till's last push/pull, unlink one.
 * Sits on the #1662 endpoints; the sync times come from the sync-status feed.
 * Composes <SalesSyncPairingPanel> and <SalesSyncDeviceList>.
 *
 * Auto-imported as <SalesSyncDevices>.
 */
interface Device {
  deviceId: string
  type: string
  claimedAt: string | number | null
}
interface SyncDevice { deviceId: string, lastContactAt: number | null, lastPullAt?: number | null }

const { t } = useT()
const { teamSlug } = useTeamContext()

const base = computed(() => `/api/crouton-sales/teams/${teamSlug.value}`)

const { data: devices, refresh, error: loadError } = await useFetch<Device[]>(
  () => `${base.value}/devices`,
  { default: () => [] }
)
const { data: sync, refresh: refreshSync } = await useFetch<{ devices?: SyncDevice[], serverNow: number }>(
  () => `${base.value}/sync-status`,
  { default: () => ({ devices: [], serverNow: Date.now() }) }
)

const panel = useTemplateRef<{ pair: () => Promise<void> }>('panel')
const reload = () => Promise.all([refresh(), refreshSync()])
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">{{ t('sales.devices.title') }}</h2>
      <SalesSyncPairingPanel ref="panel" @closed="reload" />
    </div>

    <UAlert v-if="loadError" color="error" variant="subtle" :title="t('sales.devices.loadFailed')" />
    <SalesSyncDeviceList
      v-else
      :devices="devices"
      :sync-devices="sync?.devices ?? []"
      :now="sync?.serverNow ?? Date.now()"
      @pair="panel?.pair()"
      @unlinked="refresh()"
    />
  </div>
</template>
