<!--
  SalesSettingsPrintPreviewModal (#1504)
  Preview what a printer actually prints. Fetches the server-rendered ticket
  (renderTicketHtml — the exact browser-print engine) for this printer + event
  and drops it into a SANDBOXED iframe, so the preview can't drift from reality
  and the ticket's own print CSS can't leak into the app. Reflects the saved
  printer (Prijzen tonen + type) and the event's saved receipt-text settings.
  Preview-only: Testprint lives in the printer form beside the Voorbeeld button.
-->
<template>
  <UModal v-model:open="isOpen">
    <template #content="{ close }">
      <div class="p-6 space-y-4">
        <h3 class="text-lg font-semibold">{{ t('sales.print.previewTitle', 'Voorbeeld') }}</h3>

        <div v-if="pending" class="p-10 flex justify-center">
          <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
        </div>

        <UAlert
          v-else-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="t('sales.print.previewFailed', 'Kon voorbeeld niet laden')"
          :description="errorMessage"
        />

        <template v-else-if="data">
          <!-- Printer info (chrome — themed) -->
          <div class="rounded-lg bg-elevated p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><span class="text-muted">{{ t('sales.print.name', 'Naam') }}:</span> {{ data.printer.title }}</div>
            <div><span class="text-muted">{{ t('sales.print.ipAddress', 'IP') }}:</span> {{ data.printer.ipAddress }}:{{ data.printer.port || 9100 }}</div>
            <div>
              <span class="text-muted">{{ t('sales.form.printerType', 'Type') }}:</span>
              {{ data.printer.type === 'receipt' ? t('sales.form.printerTypeReceipt', 'Afrekening') : t('sales.form.printerTypeKitchen', 'Bestelling') }}
            </div>
            <div>
              <span class="text-muted">{{ t('sales.form.showPrices', 'Prijzen') }}:</span>
              <UBadge :color="data.printer.showPrices ? 'primary' : 'neutral'" variant="soft" size="xs" class="ml-1">
                {{ data.printer.showPrices ? t('sales.common.on', 'Aan') : t('sales.common.off', 'Uit') }}
              </UBadge>
            </div>
          </div>

          <!-- The ticket — real renderTicketHtml output in a sandboxed iframe.
               Deliberately NOT themed (#1394): it mocks physical thermal paper,
               so it stays literal white/ink regardless of app theme. -->
          <div class="rounded-lg bg-[#e7e7ea] p-4 flex justify-center">
            <iframe
              :srcdoc="data.html"
              sandbox=""
              title="ticket"
              class="w-[312px] h-[420px] border-0 bg-white shadow-xl"
            />
          </div>

          <p class="text-xs text-muted text-center">
            {{ t('sales.print.previewNote', 'Zoals de printer hem afdrukt · met je opgeslagen instellingen') }}
          </p>
        </template>
        <div class="flex justify-end w-full">
          <UButton variant="outline" color="neutral" @click="close">
            {{ t('sales.common.close', 'Sluiten') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
const props = defineProps<{
  /** v-model:open */
  open: boolean
  printerId: string
  eventId: string
  /** Team route param (uuid or slug) for the endpoint URL. */
  teamParam: string
}>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const { t } = useT()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

interface PreviewResponse {
  html: string
  printer: { title: string, ipAddress: string, port: number | null, type: string, showPrices: boolean, isActive: boolean }
}

const data = ref<PreviewResponse | null>(null)
const pending = ref(false)
const error = ref<unknown>(null)
const errorMessage = computed(() => {
  const e = error.value as { data?: { statusText?: string }, message?: string } | null
  return e?.data?.statusText || e?.message || t('sales.orders.error', 'Er ging iets mis')
})

async function load() {
  if (!props.printerId || !props.eventId) return
  pending.value = true
  error.value = null
  try {
    data.value = await $fetch<PreviewResponse>(
      `/api/crouton-sales/teams/${props.teamParam}/events/${props.eventId}/printers/${props.printerId}/preview`
    )
  }
  catch (e: unknown) {
    error.value = e
    data.value = null
  }
  finally {
    pending.value = false
  }
}

// Fetch each time the modal opens (settings/prices may have changed since last).
watch(isOpen, (open) => {
  if (open) load()
})
</script>
