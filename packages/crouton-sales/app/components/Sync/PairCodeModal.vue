<script setup lang="ts">
/**
 * One-time pairing code dialog for linking a till (#806): the code, a live
 * expiry countdown and the copy-paste install command for the print router.
 *
 * Auto-imported as <SalesSyncPairCodeModal>.
 */
const props = defineProps<{
  code: { code: string, expiresAt: string | number } | null
  /** Bump to reset the countdown clock when a fresh code is issued. */
  issuedAt?: number
}>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useT()
const toast = useToast()

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
onMounted(() => { ticker = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => clearInterval(ticker))
watch(() => props.issuedAt, () => { now.value = Date.now() })

const remainingMs = computed(() => props.code ? new Date(props.code.expiresAt).getTime() - now.value : 0)
const countdown = computed(() => {
  const s = Math.max(0, Math.floor(remainingMs.value / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

const RAW = 'https://raw.githubusercontent.com/FriendlyInternet/nuxt-crouton/main/apps/kassa/deploy/install.sh'
const installCommand = computed(() => {
  const origin = import.meta.client ? window.location.origin : ''
  return `curl -fsSL ${RAW} | sudo bash -s -- --api-url ${origin} --code ${props.code?.code ?? ''}`
})

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: t('sales.devices.copied'), color: 'success' })
  }
  catch { /* clipboard blocked: the text stays selectable */ }
}
</script>

<template>
  <UModal v-model:open="open" :title="t('sales.devices.codeTitle')" :description="t('sales.devices.codeHelp')">
    <template #body>
      <div v-if="code" class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <span class="break-all font-mono text-3xl font-bold tracking-widest">{{ code.code }}</span>
          <UButton
            icon="i-lucide-copy"
            variant="outline"
            :aria-label="t('sales.devices.copy')"
            @click="copy(code.code)"
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
      <UButton variant="outline" @click="open = false">{{ t('sales.devices.close') }}</UButton>
    </template>
  </UModal>
</template>
