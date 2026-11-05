<script setup lang="ts">
/**
 * Pairing (#806): the "link a till" button plus the one-time code dialog with its
 * countdown and install command. Auto-imported as <SalesSyncPairingPanel>.
 */
const emit = defineEmits<{ closed: [] }>()

const { t } = useT()
const toast = useToast()
const { teamSlug } = useTeamContext()

const base = computed(() => `/api/crouton-sales/teams/${teamSlug.value}`)

const codeOpen = ref(false)
const pairing = ref(false)
const pairCode = ref<{ code: string, expiresAt: string | number } | null>(null)
const now = useNow({ interval: 1000 })

const remainingMs = computed(() => pairCode.value ? new Date(pairCode.value.expiresAt).getTime() - now.value.getTime() : 0)
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
    emit('closed')
  }
})

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: t('sales.devices.copied'), color: 'success' })
  }
  catch { /* clipboard blocked: the text stays selectable */ }
}

defineExpose({ pair })
</script>

<template>
  <div>
    <UButton icon="i-lucide-monitor-smartphone" :loading="pairing" @click="pair">
      {{ t('sales.devices.pair') }}
    </UButton>

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
  </div>
</template>
