<script setup lang="ts">
/**
 * Linked devices (#806): link a till with a one-time pairing code, list the
 * team's tills and print routers with each till's last push/pull, unlink one.
 * Sits on the #1662 endpoints; the sync times come from the sync-status feed.
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
const ageLabel = useSyncAge()
const toast = useToast()
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

// The sync feed ids carry a `device:` prefix the grant ids may not.
const bare = (id: string) => id.replace(/^device:/, '')
const syncOf = (id: string) => sync.value?.devices?.find(d => bare(d.deviceId) === bare(id))
const shortId = (id: string) => bare(id).slice(0, 8) || '—'

function agoOf(at: number | null | undefined): string {
  if (!at) return t('sales.sync.never')
  return ageLabel((sync.value?.serverNow ?? Date.now()) - at)
}
const dateOf = (at: string | number | null) => at ? new Date(at).toLocaleDateString() : '—'

// --- pairing code -----------------------------------------------------------
const codeOpen = ref(false)
const pairing = ref(false)
const pairCode = ref<{ code: string, expiresAt: string | number } | null>(null)
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
onMounted(() => { ticker = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => clearInterval(ticker))

const remainingMs = computed(() => pairCode.value ? new Date(pairCode.value.expiresAt).getTime() - now.value : 0)
const countdown = computed(() => {
  const s = Math.max(0, Math.floor(remainingMs.value / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

const RAW = 'https://raw.githubusercontent.com/FriendlyInternet/nuxt-crouton/main/apps/kassa/deploy/install.sh'
const installCommand = computed(() => {
  const origin = import.meta.client ? window.location.origin : ''
  return `curl -fsSL ${RAW} | sudo bash -s -- --api-url ${origin} --code ${pairCode.value?.code ?? ''}`
})

async function pair() {
  pairing.value = true
  try {
    pairCode.value = await $fetch<{ code: string, expiresAt: string | number }>(`${base.value}/devices/pairing-codes` as string, { method: 'POST', body: {} })
    now.value = Date.now()
    codeOpen.value = true
  }
  catch {
    toast.add({ title: t('sales.devices.pairFailed'), color: 'error' })
  }
  finally {
    pairing.value = false
  }
}

watch(codeOpen, (open) => {
  if (!open) {
    pairCode.value = null // shown once; closing hides it
    refresh()
    refreshSync()
  }
})

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: t('sales.devices.copied'), color: 'success' })
  }
  catch { /* clipboard blocked: the text stays selectable */ }
}

// --- unlink ----------------------------------------------------------------
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
    await $fetch<unknown>(`${base.value}/devices/${encodeURIComponent(d.deviceId)}` as string, { method: 'DELETE' })
    toast.add({ title: t('sales.devices.unlinked'), color: 'success' })
    unlinkTarget.value = null
    await refresh()
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
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">{{ t('sales.devices.title') }}</h2>
      <UButton icon="i-lucide-monitor-smartphone" :loading="pairing" @click="pair">
        {{ t('sales.devices.pair') }}
      </UButton>
    </div>

    <UAlert v-if="loadError" color="error" variant="subtle" :title="t('sales.devices.loadFailed')" />

    <div
      v-else-if="!devices.length"
      class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default p-8 text-center"
    >
      <UIcon name="i-lucide-monitor-smartphone" class="size-8 text-muted" />
      <p class="text-muted">{{ t('sales.devices.empty') }}</p>
      <UButton variant="outline" :loading="pairing" @click="pair">{{ t('sales.devices.pair') }}</UButton>
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
            {{ t('sales.sync.lastPush') }}: {{ agoOf(syncOf(d.deviceId)?.lastContactAt) }} ·
            {{ t('sales.sync.lastPull') }}: {{ agoOf(syncOf(d.deviceId)?.lastPullAt) }}
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

    <UModal v-model:open="codeOpen" :title="t('sales.devices.codeTitle')" :description="t('sales.devices.codeHelp')">
      <template #body>
        <div v-if="pairCode" class="space-y-4">
          <div class="flex items-center justify-between gap-3">
            <span class="break-all font-mono text-3xl font-bold tracking-widest">{{ pairCode.code }}</span>
            <UButton
              icon="i-lucide-copy"
              variant="outline"
              :aria-label="t('sales.devices.copy')"
              @click="copy(pairCode.code)"
            />
          </div>
          <p class="text-sm" :class="remainingMs > 0 ? 'text-muted' : 'text-error'">
            {{ remainingMs > 0 ? t('sales.devices.expires', { time: countdown }) : t('sales.devices.expired') }}
          </p>
          <div class="space-y-1">
            <p class="text-sm font-medium">{{ t('sales.devices.installLabel') }}</p>
            <pre class="overflow-x-auto rounded-md bg-elevated p-3 text-xs">{{ installCommand }}</pre>
            <UButton size="sm" variant="outline" icon="i-lucide-copy" @click="copy(installCommand)">
              {{ t('sales.devices.copy') }}
            </UButton>
          </div>
        </div>
      </template>
      <template #footer>
        <UButton variant="outline" @click="codeOpen = false">{{ t('sales.devices.close') }}</UButton>
      </template>
    </UModal>

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
