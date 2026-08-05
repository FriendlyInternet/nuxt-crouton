<script setup lang="ts">
/**
 * "Koppel router" (#1366) — the app half of the inverse pairing. The router
 * prints a ticket with its Router-ID + code; the operator types them here
 * and the router is claimed for the whole team (per-event routing stays the
 * Print flow picker's job, #1324). Mounted in the picker's Setup panel via
 * the `setup-extra` slot; also lists the claimed router(s) with a revoke.
 */
const props = defineProps<{
  teamParam: string
}>()

const { t } = useT()
const notify = useNotify()

const endpoint = computed(() => `/api/crouton-sales/teams/${props.teamParam}/print-devices`)

interface ClaimedDevice { deviceId: string, claimedAt: string }
// Deliberately not awaited: this mounts inside the picker's lazily-rendered
// Setup collapsible, where no <Suspense> boundary is waiting for it.
const { data: devices, refresh } = useFetch<ClaimedDevice[]>(endpoint, {
  default: () => []
})

const deviceIdInput = ref('')
const codeInput = ref('')
const claiming = ref(false)
const canClaim = computed(() => deviceIdInput.value.trim().length >= 6 && codeInput.value.trim().length >= 4)

async function claimDevice() {
  claiming.value = true
  try {
    await $fetch(endpoint.value, {
      method: 'POST',
      body: { deviceId: deviceIdInput.value, code: codeInput.value }
    })
    deviceIdInput.value = ''
    codeInput.value = ''
    await refresh()
    notify.success(t('sales.printFlow.pairing.claimSuccess', 'Router coupled — it starts printing within ~30 seconds'))
  }
  catch (error: unknown) {
    const status = (error as { statusCode?: number })?.statusCode
    notify.error(status === 409
      ? t('sales.printFlow.pairing.claimConflict', 'This router is coupled to another team — revoke it there first')
      : t('sales.printFlow.pairing.claimError', 'Could not couple the router — check the id and code on the ticket'))
  }
  finally {
    claiming.value = false
  }
}

const revoking = ref<string | null>(null)
async function revokeDevice(deviceId: string) {
  revoking.value = deviceId
  try {
    await $fetch(`${endpoint.value}/${deviceId}`, { method: 'DELETE' })
    await refresh()
    notify.success(t('sales.printFlow.pairing.revokeSuccess', 'Router uncoupled — it will print a new pairing ticket'))
  }
  catch {
    notify.error(t('sales.printFlow.pairing.revokeError', 'Could not uncouple the router'))
  }
  finally {
    revoking.value = null
  }
}
</script>

<template>
  <div class="mt-3 space-y-3 rounded-lg bg-elevated/60 p-3">
    <div class="space-y-1">
      <p class="text-sm font-medium leading-5">{{ t('sales.printFlow.pairing.title', 'Koppel router') }}</p>
      <p class="text-sm text-muted">{{ t('sales.printFlow.pairing.description', 'A factory-fresh router prints its own pairing ticket. Enter the Router-ID and code from that ticket — after that, new events need nothing on the router.') }}</p>
    </div>

    <ul v-if="devices.length > 0" class="space-y-1">
      <li
        v-for="device in devices"
        :key="device.deviceId"
        class="flex items-center gap-2.5 rounded-lg bg-accented/60 px-3 py-2"
      >
        <UIcon name="i-lucide-router" class="size-4 shrink-0 text-muted" />
        <code class="min-w-0 flex-1 truncate font-mono text-sm">{{ device.deviceId }}</code>
        <UButton
          size="xs"
          variant="ghost"
          color="error"
          icon="i-lucide-unlink"
          :loading="revoking === device.deviceId"
          :aria-label="t('sales.printFlow.pairing.revoke', 'Uncouple')"
          @click="revokeDevice(device.deviceId)"
        />
      </li>
    </ul>

    <div class="flex flex-wrap items-center gap-1.5">
      <UInput
        v-model="deviceIdInput"
        size="sm"
        class="min-w-36 flex-1"
        :ui="{ base: 'font-mono' }"
        :placeholder="t('sales.printFlow.pairing.deviceId', 'Router-ID')"
      />
      <UInput
        v-model="codeInput"
        size="sm"
        class="w-24"
        :ui="{ base: 'font-mono' }"
        :placeholder="t('sales.printFlow.pairing.code', 'Code')"
      />
      <UButton
        size="sm"
        icon="i-lucide-link"
        :disabled="!canClaim"
        :loading="claiming"
        :label="t('sales.printFlow.pairing.claim', 'Koppel')"
        @click="claimDevice"
      />
    </div>
  </div>
</template>
