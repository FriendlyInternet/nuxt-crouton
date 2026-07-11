<template>
  <UModal v-model:open="isOpen">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-eye" class="w-5 h-5" />
        <span>{{ t('sales.print.previewTitle') }}</span>
      </div>
    </template>

    <template #body>
      <div v-if="printer" class="space-y-4">
        <!-- Printer Info -->
        <UCard>
          <div class="space-y-3">
            <h4 class="font-medium">{{ t('sales.print.printerInformation') }}</h4>
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span class="font-medium">{{ t('sales.print.name') }}:</span>
                {{ printer.title }}
              </div>
              <div>
                <span class="font-medium">{{ t('sales.print.ipAddress') }}:</span>
                {{ printer.ipAddress }}:{{ printer.port || '9100' }}
              </div>
              <div>
                <span class="font-medium">{{ t('sales.print.location') }}:</span>
                {{ locationName || t('sales.common.none') }}
              </div>
              <div>
                <span class="font-medium">{{ t('sales.print.status') }}:</span>
                <UBadge
                  :color="printer.isActive ? 'success' : 'neutral'"
                  variant="soft"
                  size="xs"
                  class="ml-1"
                >
                  {{ printer.isActive ? t('sales.common.active') : t('sales.common.inactive') }}
                </UBadge>
              </div>
            </div>
          </div>
        </UCard>

        <!-- Receipt Preview — deliberately NOT themed (#1394): this mocks the
             physical thermal paper the printer spits out, so it keeps literal
             paper white / ink gray regardless of app theme (chrome-vs-data
             rule: the modal chrome themes, the paper mock doesn't). -->
        <UCard class="bg-gray-50 dark:bg-gray-900">
          <div class="flex justify-center">
            <div
              class="bg-white shadow-xl rounded-lg overflow-hidden"
              style="width: 320px; font-family: 'Courier New', monospace;"
            >
              <div class="p-4" style="background: linear-gradient(to bottom, #ffffff 0%, #f8f8f8 100%);">
                <!-- Header -->
                <div class="text-center border-b-2 border-dashed border-gray-400 pb-2 mb-2">
                  <div class="font-bold text-lg">PRINTER TEST</div>
                </div>

                <!-- Printer Details -->
                <div class="text-sm py-2">
                  <div>Printer: {{ printer.title }}</div>
                  <div>IP: {{ printer.ipAddress }}:{{ printer.port || '9100' }}</div>
                  <div>Time: {{ currentTime }}</div>
                </div>

                <div class="border-t-2 border-dashed border-gray-400 my-2" />

                <!-- Sample Order -->
                <div class="font-bold text-lg py-1">
                  Sample Order #12345
                </div>

                <div class="text-sm space-y-1">
                  <div class="flex justify-between">
                    <span>1x Sample Product</span>
                    <span v-if="printer.showPrices">$10.00</span>
                  </div>
                  <div class="flex justify-between">
                    <span>2x Another Item</span>
                    <span v-if="printer.showPrices">$15.00</span>
                  </div>
                </div>

                <div class="border-t-2 border-dashed border-gray-400 my-2" />

                <div class="text-sm py-1 font-bold">
                  {{ receiptSettings.special_instructions_title }}
                </div>
                <div class="text-sm">
                  Please serve with extra napkins
                </div>

                <div class="border-t-2 border-dashed border-gray-400 my-2" />

                <div v-if="printer.showPrices" class="flex justify-between font-bold text-lg py-1">
                  <span>TOTAL:</span>
                  <span>$25.00</span>
                </div>

                <div class="border-t-2 border-dashed border-gray-400 my-2" />

                <!-- Footer -->
                <div class="text-center text-sm py-2">
                  {{ receiptSettings.footer_text }}
                </div>

                <!-- Tear edge effect -->
                <div
                  class="mt-4 -mx-4 h-4"
                  style="background: repeating-linear-gradient(90deg, transparent 0, transparent 6px, #e5e5e5 6px, #e5e5e5 8px);"
                />
              </div>
            </div>
          </div>
        </UCard>

        <!-- Info Alert -->
        <UAlert
          icon="i-lucide-info"
          color="info"
          variant="soft"
          :title="t('sales.print.previewInformation')"
        >
          <template #description>
            {{ t('sales.print.previewDescription') }}
          </template>
        </UAlert>
      </div>
      <div v-else class="p-8 text-center text-muted">
        {{ t('sales.print.noPrinterSelected') }}
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-3">
        <UButton variant="outline" @click="close">
          {{ t('sales.common.close') }}
        </UButton>
        <UButton
          v-if="printer"
          color="primary"
          icon="i-lucide-printer"
          :loading="testPrinting"
          :disabled="!printer.isActive"
          @click="testPrint"
        >
          {{ t('sales.print.testPrint') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { SalesPrinter } from '../../types'
import type { ReceiptSettings } from './ReceiptSettingsModal.vue'

const props = defineProps<{
  modelValue: boolean
  printer: SalesPrinter | null
  /** API endpoint for test print (e.g., '/api/teams/xxx/pos-printers') */
  testPrintApiBase: string
  receiptSettings: ReceiptSettings
  /** Location name to display (optional) */
  locationName?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'test-print': [printer: SalesPrinter]
}>()

const notify = useNotify()
const { t } = useT()

const isOpen = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const testPrinting = ref(false)

const currentTime = computed(() => new Date().toLocaleString())

async function testPrint() {
  if (!props.printer) return

  testPrinting.value = true
  try {
    await $fetch(
      `${props.testPrintApiBase}/${props.printer.id}/test`,
      { method: 'POST' },
    )
    notify.success(t('sales.print.testQueued'), { description: t('sales.print.testQueuedDesc') })
    emit('test-print', props.printer)
  }
  catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : t('sales.print.testFailed')
    notify.error(t('sales.orders.error'), { description: errorMessage })
  }
  finally {
    testPrinting.value = false
  }
}

function close() {
  isOpen.value = false
}
</script>
