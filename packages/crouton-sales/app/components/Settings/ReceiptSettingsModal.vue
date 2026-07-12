<template>
  <UModal v-model:open="isOpen">
    <template #content="{ close }">
      <div class="p-6 space-y-6">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-receipt" class="w-5 h-5" />
          <span class="text-lg font-semibold">{{ t('sales.receipt.settingsTitle') }}</span>
        </div>

        <p class="text-sm text-muted">
          {{ t('sales.receipt.customize') }}
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UFormField :label="t('sales.receipt.specialInstructionsTitle')" :help="t('sales.receipt.specialInstructionsHelp')">
            <UInput
              v-model="settings.special_instructions_title"
              placeholder="OPMERKING:"
            />
          </UFormField>

          <UFormField :label="t('sales.receipt.staffOrderHeader')" :help="t('sales.receipt.staffOrderHeaderHelp')">
            <UInput
              v-model="settings.staff_order_header"
              placeholder="*** PERSONEEL ***"
            />
          </UFormField>
        </div>

        <UFormField :label="t('sales.receipt.footerText')" :help="t('sales.receipt.footerTextHelp')">
          <UTextarea
            v-model="settings.footer_text"
            :rows="2"
            placeholder="Bedankt voor je bestelling!"
          />
        </UFormField>

        <div class="flex justify-end gap-3">
          <UButton variant="outline" @click="close">
            {{ t('sales.common.cancel') }}
          </UButton>
          <UButton
            color="primary"
            :loading="saving"
            @click="save"
          >
            {{ t('sales.receipt.saveSettings') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
export interface ReceiptSettings {
  special_instructions_title: string
  staff_order_header: string
  footer_text: string
}

const props = defineProps<{
  modelValue: boolean
  /** API endpoint path for loading/saving settings */
  apiEndpoint: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'saved': []
}>()

const notify = useNotify()
const { t } = useT()

const isOpen = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const saving = ref(false)

// Defaults mirror crouton-printing's canonical DEFAULT_RECEIPT_SETTINGS (Dutch),
// so the form matches what actually prints for an unsaved event (#1514).
const settings = ref<ReceiptSettings>({
  special_instructions_title: 'OPMERKING:',
  staff_order_header: '*** PERSONEEL ***',
  footer_text: 'Bedankt voor je bestelling!',
})

async function loadSettings() {
  try {
    const data = await $fetch<ReceiptSettings>(props.apiEndpoint)
    settings.value = data
  }
  catch (error) {
    console.error('Error loading receipt settings:', error)
  }
}

async function save() {
  saving.value = true
  try {
    await $fetch(props.apiEndpoint, {
      method: 'PUT',
      body: settings.value,
    })
    notify.success(t('sales.receipt.settingsSaved'), { description: t('sales.receipt.settingsSavedDesc') })
    emit('saved')
    close()
  }
  catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : t('sales.receipt.saveFailed')
    notify.error(t('sales.orders.error'), { description: errorMessage })
  }
  finally {
    saving.value = false
  }
}

function close() {
  isOpen.value = false
}

watch(isOpen, (newValue) => {
  if (newValue) {
    loadSettings()
  }
})
</script>
