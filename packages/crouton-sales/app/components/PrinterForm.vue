<!--
  SalesPrinterForm
  Package-provided form for the sales printers collection.
  Replaces the CLI-generated _Form.vue (wired via componentName in
  useSalesPrinters config). Event is implied by the event workspace.
-->

<template>
  <CroutonFormActionButton
    v-if="action === 'delete'"
    :action="action"
    :collection="collection"
    :items="items"
    :loading="loading"
    @click="handleSubmit"
  />

  <UForm
    v-else
    :schema="formSchema"
    :state="state"
    @submit="handleSubmit"
    @error="handleValidationError"
  >
    <CroutonFormLayout :navigation-items="navigationItems" v-model="activeSection">
      <template #main>
        <div class="flex flex-col gap-4 p-1">
          <SalesFormEventTitleFields v-model:event-id="state.eventId" v-model:title="state.title" :hide-event="hideEvent" />

          <!-- Output driver: how this station prints. Thermal (network ESC/POS)
               is the default; browser-print fulfils via the OS / AirPrint dialog
               on a print-bridge screen and needs no printer IP. -->
          <UFormField :label="t('sales.form.driver')" name="driver" :help="t('sales.form.driverHelp')" class="not-last:pb-4">
            <URadioGroup
              v-model="state.driver"
              :items="driverItems"
              variant="card"
              orientation="horizontal"
              :ui="{ item: 'flex-1 items-start', fieldset: 'w-full gap-2' }"
            >
              <template #label="{ item }">
                <span class="flex items-center gap-1.5">
                  <UIcon :name="(item as any).icon" class="size-4 shrink-0 text-muted" />
                  {{ (item as any).label }}
                </span>
              </template>
            </URadioGroup>
          </UFormField>

          <!-- Type sits above location: it decides whether location shows at all. -->
          <UFormField :label="t('sales.form.printerType')" name="type" class="not-last:pb-4">
            <URadioGroup
              v-model="state.type"
              :items="printerTypeItems"
              variant="card"
              orientation="horizontal"
              :ui="{ item: 'flex-1 items-start', fieldset: 'w-full gap-2' }"
            >
              <template #label="{ item }">
                <span class="flex items-center gap-1.5">
                  <UIcon :name="(item as any).icon" class="size-4 shrink-0 text-muted" />
                  {{ (item as any).label }}
                </span>
              </template>
            </URadioGroup>
          </UFormField>

          <!-- Location is the kitchen routing key; receipt printers print the
               whole order and never read it, so the field hides for them. -->
          <UFormField
            v-if="state.type !== 'receipt'"
            :label="t('sales.form.location')"
            name="locationId"
            class="not-last:pb-4"
          >
            <CroutonFormReferenceSelect
              v-model="state.locationId"
              collection="salesLocations"
              :label="t('sales.form.location')"
              :create-initial-data="{ eventId: state.eventId }"
            />
          </UFormField>

          <!-- IP only matters for the network thermal driver; browser-print
               prints through the OS dialog and carries no IP. -->
          <UFormField
            v-if="state.driver !== 'browser-print'"
            :label="t('sales.form.ipAddress')"
            name="ipAddress"
            :help="t('sales.form.ipAddressHelp')"
            class="not-last:pb-4"
          >
            <UInput
              v-model="state.ipAddress"
              class="w-full"
              size="xl"
              icon="i-lucide-network"
              placeholder="192.168.1.70"
              :ui="{ base: 'font-mono' }"
            />
          </UFormField>

          <div class="rounded-lg border border-default divide-y divide-default">
            <UFormField name="showPrices">
              <div class="flex items-center justify-between gap-4 p-4">
                <div>
                  <p class="text-sm font-medium text-highlighted">{{ t('sales.form.showPrices') }}</p>
                  <p class="text-xs text-muted mt-0.5">{{ t('sales.form.showPricesHelp') }}</p>
                </div>
                <USwitch v-model="state.showPrices" />
              </div>
            </UFormField>

            <UFormField name="isActive">
              <div class="flex items-center justify-between gap-4 p-4">
                <div>
                  <p class="text-sm font-medium text-highlighted">{{ t('sales.common.active') }}</p>
                  <p class="text-xs text-muted mt-0.5">{{ t('sales.form.printerActiveHelp') }}</p>
                </div>
                <USwitch v-model="state.isActive" />
              </div>
            </UFormField>
          </div>
        </div>
      </template>

      <template #footer>
        <!-- List the actual messages: schema fields without a rendered input
             (e.g. nullable DB columns) would otherwise surface as an opaque
             "1 error in General" with nothing to correct. -->
        <UAlert
          v-if="validationErrors.length > 0"
          color="error"
          icon="i-lucide-triangle-alert"
          :title="t('validation.fixErrors', { count: validationErrors.length })"
          class="mb-4"
        >
          <template #description>
            <ul class="mt-2 space-y-1 text-xs">
              <li v-for="err in validationErrors" :key="err.name">
                <span class="font-medium">{{ fieldLabel(err.name) }}:</span> {{ err.message }}
              </li>
            </ul>
          </template>
        </UAlert>

        <!-- Delete pill left, save stretches over the rest (items-stretch keeps
             the pill the same height as the save button). -->
        <div class="flex items-stretch gap-2">
          <CroutonDeleteButton
            v-if="action === 'update' && state.id"
            expanded
            :loading="deleting"
            @confirm="handleDelete"
          />
          <!-- Testprint (#1391): a tiny ticket through the REAL print flow
               (queue → the event's transport → paper) — proves the whole
               chain, not just this form's values. Saved printers only. -->
          <UButton
            v-if="action === 'update' && state.id"
            variant="outline"
            color="neutral"
            icon="i-lucide-printer-check"
            :loading="testPrinting"
            @click="handleTestPrint"
          >
            {{ t('sales.form.testPrint', 'Testprint') }}
          </UButton>
          <CroutonFormActionButton
            class="flex-1"
            :action="action"
            :collection="collection"
            :items="items"
            :loading="loading"
            :has-validation-errors="validationErrors.length > 0"
          />
        </div>
      </template>
    </CroutonFormLayout>
  </UForm>
</template>

<script setup lang="ts">
// useSalesPrinters is auto-imported from the generated collection layer at runtime.
declare function useSalesPrinters(): {
  defaultValue: Record<string, any>
  schema: any
  collection: string
}

interface PrinterFormProps {
  action: 'create' | 'update' | 'delete'
  items?: Array<{ id: string }>
  activeItem?: Record<string, any> | null
}

const props = defineProps<PrinterFormProps>()
const { t } = useT()
const { defaultValue, schema, collection } = useSalesPrinters()

const navigationItems = [
  { label: t('sales.form.general'), value: 'general' }
]

const printerTypeItems = [
  {
    label: t('sales.form.printerTypeKitchen'),
    description: t('sales.form.printerTypeKitchenHelp'),
    icon: 'i-lucide-chef-hat',
    value: 'kitchen'
  },
  {
    label: t('sales.form.printerTypeReceipt'),
    description: t('sales.form.printerTypeReceiptHelp'),
    icon: 'i-lucide-receipt-text',
    value: 'receipt'
  }
]

// Output drivers (how a station is fulfilled). network-escpos = the default
// thermal TCP path; browser-print = OS / AirPrint dialog via a print-bridge
// screen. Other drivers (display, webusb, …) are not offered here.
const driverItems = [
  {
    label: t('sales.form.driverNetwork'),
    description: t('sales.form.driverNetworkHelp'),
    icon: 'i-lucide-network',
    value: 'network-escpos'
  },
  {
    label: t('sales.form.driverBrowser'),
    description: t('sales.form.driverBrowserHelp'),
    icon: 'i-lucide-printer',
    value: 'browser-print'
  }
]

const activeSection = ref('general')

const validationErrors = ref<Array<{ name: string, message: string }>>([])
const handleValidationError = (event: any) => {
  if (event?.errors) validationErrors.value = event.errors
}

// Human label for an error's field — falls back to the raw schema field name
// for fields that have no input in this form (port, status, …).
const fieldLabels: Record<string, string> = {
  eventId: t('sales.form.event'),
  locationId: t('sales.form.location'),
  title: t('sales.form.title'),
  ipAddress: t('sales.form.ipAddress'),
  driver: t('sales.form.driver'),
  type: t('sales.form.printerType'),
  showPrices: t('sales.form.showPrices'),
  isActive: t('sales.common.active')
}
const fieldLabel = (name: string) => fieldLabels[name] || name

// Shared scaffold: state (activeItem-merged), submit switch, in-form delete.
const { state, hideEvent, loading, close, submitAction, deleting, handleDelete }
  = useSalesCollectionForm(props, { collection, defaultValue })

// Pre-existing printers have no type column value — they are kitchen printers.
if (!state.value.type) state.value.type = 'kitchen'
// Pre-existing printers have no driver — they are network thermal stations.
if (!state.value.driver) state.value.driver = 'network-escpos'

// Location only routes kitchen tickets — required there, meaningless for
// receipt printers (the generated schema leaves it nullish for that reason).
const formSchema = schema.superRefine((data: Record<string, any>, ctx: { addIssue: (issue: Record<string, any>) => void }) => {
  if (data.type !== 'receipt' && !data.locationId) {
    ctx.addIssue({ code: 'custom', path: ['locationId'], message: t('sales.form.locationRequired') })
  }
})

// Switching to receipt drops the stale routing key (the field is hidden then).
watch(() => state.value.type, (type) => {
  if (type === 'receipt') state.value.locationId = null
})

const handleSubmit = async () => {
  // Pre-existing receipt printers may still carry a location from before the
  // field was hidden — drop it on save so routing data stays clean.
  if (state.value.type === 'receipt') state.value.locationId = null
  // browser-print has no IP, but the column is NOT NULL / schema requires a
  // non-empty string — store a sentinel (routing never reads it: the thermal
  // spooler GET excludes browser-print jobs by driver).
  if (state.value.driver === 'browser-print' && !state.value.ipAddress) {
    state.value.ipAddress = 'browser-print'
  }
  try {
    await submitAction()
    validationErrors.value = []
    close()
  } catch (error) {
    console.error('Form submission failed:', error)
  }
}

// Testprint (#1391): POST the team-authed probe endpoint; the job then rides
// the event's Print flow like any order ticket. Outcome shows on the printer
// LEDs / job list — the toast only confirms "queued".
const notify = useNotify()
const route = useRoute()
const testPrinting = ref(false)

async function handleTestPrint() {
  if (!state.value.id || !state.value.eventId) return
  testPrinting.value = true
  try {
    await $fetch(
      `/api/crouton-sales/teams/${route.params.team}/events/${state.value.eventId}/printers/${state.value.id}/test-print`,
      { method: 'POST' }
    )
    notify.success(t('sales.form.testPrintQueued', 'Test ticket queued — watch the printer'))
  }
  catch (e: unknown) {
    const description = (e as { data?: { statusText?: string } })?.data?.statusText
    notify.error(t('sales.form.testPrintError', 'Test print failed'), description ? { description } : undefined)
  }
  finally {
    testPrinting.value = false
  }
}

</script>