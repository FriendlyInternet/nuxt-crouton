<script setup lang="ts">
/**
 * Linked devices list (#806): each till / print router with its last push/pull and an unlink
 * action. Auto-imported as <SalesSyncDeviceList>.
 */
interface Device {
  deviceId: string
  type: string
  claimedAt: string | number | null
}
interface SyncDevice { deviceId: string, lastContactAt: number | null, lastPullAt?: number | null }

const props = defineProps<{
  devices: Device[]
  syncDevices: SyncDevice[]
  /** Server clock (ms) the sync ages are measured against. */
  now: number
}>()
const emit = defineEmits<{ pair: [], unlinked: [] }>()

const { t } = useT()
const ago = useSyncAgo()
const toast = useToast()
const { teamSlug } = useTeamContext()

// The sync feed ids carry a `device:` prefix the grant ids may not.
const bare = (id: string) => id.replace(/^device:/, '')
const syncOf = (id: string) => props.syncDevices.find(d => bare(d.deviceId) === bare(id))
const shortId = (id: string) => bare(id).slice(0, 8) || '—'
const dateOf = (at: string | number | null) => at ? new Date(at).toLocaleDateString() : '—'

const unlinkTarget = ref<Device | null>(null)
const unlinkOpen = computed({
  get: () => !!unlinkTarget.value,
  set: (v) => { if (!v) unlinkTarget.value = null }
})
const unlinking = ref(false)

async function unlink() {
  const d = unlinkTarget.value
  if (!d) return
  unlinking.value = true
  try {
    await $fetch<unknown>(`/api/crouton-sales/teams/${teamSlug.value}/devices/${encodeURIComponent(d.deviceId)}` as string, { method: 'DELETE' })
    toast.add({ title: t('sales.devices.unlinked'), color: 'success' })
    unlinkTarget.value = null
    emit('unlinked')
  }
  catch {
    toast.add({ title: t('sales.devices.unlinkFailed'), color: 'error' })
  }
  finally {
    unlinking.value = false
  }
}
</script>

<template>
  <div>
    <div
      v-if="!devices.length"
      class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default p-8 text-center"
    >
      <UIcon name="i-lucide-monitor-smartphone" class="size-8 text-muted" />
      <p class="text-muted">{{ t('sales.devices.empty') }}</p>
      <UButton variant="outline" @click="emit('pair')">{{ t('sales.devices.pair') }}</UButton>
    </div>

    <ul v-else class="divide-y divide-default rounded-lg border border-default">
      <li v-for="d in devices" :key="d.deviceId" class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-3">
        <div class="min-w-0 space-y-0.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{{ shortId(d.deviceId) }}</span>
            <UBadge
              :label="d.type === 'print-device' ? t('sales.devices.router') : t('sales.devices.till')"
              :icon="d.type === 'print-device' ? 'i-lucide-printer' : 'i-lucide-monitor-smartphone'"
              color="neutral"
              variant="subtle"
            />
          </div>
          <p class="text-sm text-muted">{{ t('sales.devices.linkedSince', { date: dateOf(d.claimedAt) }) }}</p>
          <p v-if="d.type !== 'print-device'" class="text-sm text-muted">
            {{ t('sales.sync.lastPush') }}: {{ ago(syncOf(d.deviceId)?.lastContactAt, now) }} ·
            {{ t('sales.sync.lastPull') }}: {{ ago(syncOf(d.deviceId)?.lastPullAt, now) }}
          </p>
        </div>
        <UButton
          color="error"
          variant="ghost"
          icon="i-lucide-unlink"
          :aria-label="`${t('sales.devices.unlink')} ${shortId(d.deviceId)}`"
          @click="unlinkTarget = d"
        >
          {{ t('sales.devices.unlink') }}
        </UButton>
      </li>
    </ul>

    <UModal v-model:open="unlinkOpen" :title="t('sales.devices.unlinkTitle')">
      <template #body>
        <p class="text-sm">
          {{ t('sales.devices.unlinkBody', { name: unlinkTarget ? shortId(unlinkTarget.deviceId) : '' }) }}
        </p>
      </template>
      <template #footer>
        <UButton variant="outline" @click="unlinkTarget = null">{{ t('sales.devices.cancel') }}</UButton>
        <UButton color="error" :loading="unlinking" @click="unlink">{{ t('sales.devices.unlink') }}</UButton>
      </template>
    </UModal>
  </div>
</template>
