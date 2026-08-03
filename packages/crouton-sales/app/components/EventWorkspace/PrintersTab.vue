<script setup lang="ts">
import type { SalesEvent } from '~~/layers/sales/collections/events/types'

const props = defineProps<{ event: SalesEvent }>()

const { t } = useT()
const { open } = useCrouton()
const route = useRoute()
const teamParam = computed(() => route.params.team as string)

const eventQuery = computed(() => ({ eventId: props.event.id }))
const { items: printers, pending: printersPending } = await useCollectionQuery('salesPrinters', { query: eventQuery })

// Print jobs (salesPrintqueues) scoped to this event, paginated. The list + per-row
// card render via <CroutonCollection> (card auto-resolves to SalesPrintqueuesCard).
const {
  items: printJobs,
  total: printJobsTotal,
  page: printJobsPage,
  paginationData: printJobsPagination,
  pending: printJobsPending,
  refresh: refreshPrintJobs
} = await useCollectionQuery('salesPrintqueues', {
  query: eventQuery,
  pagination: { pageSize: 10 }
})

// Print outcomes arrive seconds after the order (spooler pre-flight +
// callbacks), so poll while the tab is open — otherwise staff stare at a
// stale "Printing" badge that has long since become Done/Error.
let printJobsPoll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  printJobsPoll = setInterval(() => {
    refreshPrintJobs()
  }, 5000)
})
onUnmounted(() => {
  if (printJobsPoll) clearInterval(printJobsPoll)
})

// Requeue all failed jobs (status 9 → 0) so the spooler resends them —
// the recovery action after a printer ran out of paper or was offline.
const toast = useToast()
const resending = ref(false)

async function resendFailedJobs() {
  resending.value = true
  try {
    const res = await $fetch<{ requeued: number }>(
      `/api/crouton-sales/teams/${teamParam.value}/events/${props.event.id}/printqueues/retry-failed`,
      { method: 'POST' }
    )
    if (res.requeued > 0) {
      toast.add({
        title: t('sales.printQueue.resendQueued', { params: { count: res.requeued }, fallback: `Requeued ${res.requeued} print job(s)` }),
        color: 'success',
        icon: 'i-lucide-printer'
      })
    }
    else {
      toast.add({
        title: t('sales.printQueue.resendNone', 'No failed print jobs to resend'),
        color: 'neutral'
      })
    }
    await refreshPrintJobs()
  }
  catch (err) {
    console.error('Error requeuing print jobs:', err)
    toast.add({
      title: t('sales.printQueue.resendError', 'Could not requeue print jobs'),
      color: 'error'
    })
  }
  finally {
    resending.value = false
  }
}

function openCreatePrinter() {
  open('create', 'salesPrinters', [], 'slideover', { eventId: props.event.id })
}

const showPrinterPreview = ref(false)
// `any` here because CroutonCollection's #card-actions slot provides Row<any>
// and we just forward the row.original to the modal.
const selectedPrinter = ref<any>(null)

function openPrinterPreview(printer: any) {
  selectedPrinter.value = printer
  showPrinterPreview.value = true
}
// Receipt text now resolves server-side inside the preview endpoint (#1504) —
// the modal fetches its own data, so this tab no longer loads receipt settings.
</script>

<template>
  <div class="space-y-4">
    <div class="flex justify-end">
      <UButton color="primary" size="sm" icon="i-lucide-plus" @click="openCreatePrinter">
        {{ t('sales.workspace.addPrinter') }}
      </UButton>
    </div>
    <div v-if="printersPending" class="p-6 text-center text-muted">
      {{ t('sales.workspace.loadingPrinters') }}
    </div>
    <CroutonCollection
      v-else-if="printers && (printers as any[]).length > 0"
      layout="grid"
      collection="salesPrinters"
      :rows="printers"
    >
      <template #card-actions="{ row }">
        <UButton
          variant="ghost"
          size="xs"
          icon="i-lucide-eye"
          @click.stop="openPrinterPreview(row)"
        >
          {{ t('sales.common.preview') }}
        </UButton>
      </template>
    </CroutonCollection>
    <div v-else class="p-12 text-center text-muted">
      <UIcon name="i-lucide-printer" class="text-4xl mb-2" />
      <p>{{ t('sales.workspace.noPrinters') }}</p>
      <UButton size="sm" variant="outline" class="mt-3" @click="openCreatePrinter">
        {{ t('sales.workspace.addPrinter') }}
      </UButton>
    </div>

    <!-- Print jobs for this event -->
    <div class="space-y-3 pt-6 mt-2 border-t border-default">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-highlighted">
          {{ t('sales.printQueue.title', 'Print jobs') }}
        </h3>
        <div class="flex items-center gap-3">
          <UButton
            size="xs"
            variant="outline"
            color="neutral"
            icon="i-lucide-rotate-ccw"
            :loading="resending"
            @click="resendFailedJobs"
          >
            {{ t('sales.printQueue.resendFailed', 'Resend failed jobs') }}
          </UButton>
          <span class="text-xs text-muted tabular-nums">{{ printJobsTotal }}</span>
        </div>
      </div>
      <!-- Loading state only before the first data arrives — the 5s poll
           flips `pending` on every refresh, and swapping the list for a
           loading placeholder each time made the whole list flicker. -->
      <div v-if="printJobsPending && !(printJobs && (printJobs as any[]).length > 0)" class="p-6 text-center text-muted text-sm">
        {{ t('sales.printQueue.loading', 'Loading print jobs…') }}
      </div>
      <CroutonCollection
        v-else-if="printJobs && (printJobs as any[]).length > 0"
        layout="list"
        collection="salesPrintqueues"
        :rows="printJobs"
        server-pagination
        :pagination-data="printJobsPagination"
        @update:page="printJobsPage = $event"
      />
      <div v-else class="p-6 text-center text-muted text-sm">
        {{ t('sales.printQueue.empty', 'No print jobs yet') }}
      </div>
    </div>

    <SalesSettingsPrintPreviewModal
      v-if="selectedPrinter"
      v-model:open="showPrinterPreview"
      :printer-id="selectedPrinter.id"
      :event-id="props.event.id"
      :team-param="teamParam"
    />
  </div>
</template>
