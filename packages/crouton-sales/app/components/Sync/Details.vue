<script setup lang="ts">
/**
 * Per-till sync detail for <SalesSyncStatus detailed> (#816): each till's last
 * push/pull and the config edits that lost a conflict. Split out of Status.vue
 * so the banner's template stays small.
 */
interface LostEdit {
  id: string
  deviceId: string | null
  entityType: string
  entityId: string
  reason: string
  lost: Record<string, unknown>
  kept: Record<string, unknown>
  at: number
}

const props = defineProps<{
  devices: Array<{ deviceId: string, lastContactAt: number | null, lastPullAt?: number | null }>
  lostEdits: LostEdit[]
  /** Current time on the server's clock (ms), so ages ignore device skew. */
  now: number
  /** Show the "no lost edits" line (only once data has loaded without error). */
  showEmpty: boolean
}>()

const { t } = useT()
const ageLabel = useSyncAge()

function agoOf(at: number | null | undefined): string {
  if (!at) return t('sales.sync.never')
  return ageLabel(props.now - at)
}
const tillName = (id: string | null) => (id ?? '').replace('device:', '').slice(0, 8) || '—'
/** "price: 5 → 6" for the fields that differ; falls back to the lost values alone. */
function diffLabel(l: LostEdit): string {
  const keys = Object.keys(l.lost).filter(k => k in l.kept && JSON.stringify(l.lost[k]) !== JSON.stringify(l.kept[k]))
  return (keys.length ? keys : Object.keys(l.lost).slice(0, 3))
    .slice(0, 4)
    .map(k => `${k}: ${JSON.stringify(l.lost[k])} → ${JSON.stringify(l.kept[k] ?? null)}`)
    .join(', ')
}
</script>

<template>
  <div class="space-y-3 text-sm">
    <ul v-if="devices.length" class="divide-y divide-default rounded-lg border border-default">
      <li v-for="d in devices" :key="d.deviceId" class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
        <span class="font-medium">{{ tillName(d.deviceId) }}</span>
        <span class="text-muted">
          {{ t('sales.sync.lastPush') }}: {{ agoOf(d.lastContactAt) }} · {{ t('sales.sync.lastPull') }}: {{ agoOf(d.lastPullAt) }}
        </span>
      </li>
    </ul>
    <div v-if="lostEdits.length">
      <p class="mb-1 font-medium">{{ t('sales.sync.lostEdits') }}</p>
      <ul class="divide-y divide-default rounded-lg border border-default">
        <li v-for="l in lostEdits" :key="l.id" class="space-y-0.5 px-3 py-2">
          <div class="flex flex-wrap justify-between gap-x-4">
            <span class="font-medium">{{ l.entityType }} · {{ tillName(l.deviceId) }}</span>
            <span class="text-muted">{{ agoOf(l.at) }}</span>
          </div>
          <p class="break-words text-muted">{{ diffLabel(l) }}</p>
          <p class="text-xs text-muted">{{ t('sales.sync.cloudWon') }}</p>
        </li>
      </ul>
    </div>
    <p v-else-if="showEmpty" class="text-muted">{{ t('sales.sync.noLostEdits') }}</p>
  </div>
</template>
