<template>
  <div>
    <!-- DELETE CONFIRMATION -->
    <div
      v-if="action === 'delete'"
      class="space-y-6 p-6"
    >
      <div class="text-center space-y-4">
        <!-- Warning Icon -->
        <div class="mx-auto w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
          <UIcon
            name="i-lucide-alert-triangle"
            class="w-6 h-6 text-red-600 dark:text-red-400"
          />
        </div>

        <!-- Title -->
        <div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {{ t('admin.translations.removeOverrideTitle') }}
          </h3>
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {{ t('admin.translations.removeOverrideDescription') }}
          </p>
        </div>

        <!-- Translation Preview -->
        <div
          v-if="activeItem"
          class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 text-left"
        >
          <div class="text-xs text-blue-700 dark:text-blue-300 font-mono mb-2">
            {{ activeItem.keyPath }}
          </div>
          <TranslationsDisplay :translations="activeItem.values" />
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-3 w-full justify-center">
        <UButton
          color="neutral"
          variant="soft"
          @click="close()"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          color="error"
          :loading="loading !== 'notLoading'"
          :disabled="loading !== 'notLoading'"
          icon="i-lucide-trash-2"
          @click="handleDelete"
        >
          {{ t('admin.translations.removeOverride') }}
        </UButton>
      </div>
    </div>

    <!-- CREATE/UPDATE FORM -->
    <UForm
      v-else
      :schema="schema"
      :state="state"
      class="space-y-4 p-6"
      @submit="handleSubmit"
    >
      <!-- Key Path -->
      <UFormField
        :label="t('admin.translations.keyPath')"
        name="keyPath"
        required
      >
        <UInput
          v-model="state.keyPath"
          :placeholder="t('admin.translations.keyPathPlaceholder')"
          :disabled="!!activeItem?.id"
        />
      </UFormField>

      <!-- Category -->
      <UFormField
        :label="t('admin.translations.category')"
        name="category"
        required
      >
        <UInput
          v-model="state.category"
          :placeholder="t('admin.translations.categoryPlaceholder')"
          :disabled="!!activeItem?.id"
        />
      </UFormField>

      <!-- Translations Input -->
      <UFormField
        :label="t('admin.translations.translations')"
        name="values"
        required
      >
        <!-- @ts-expect-error dynamic props -->
        <CroutonI18nInput
          :model-value="state.values as any"
          :fields="Object.keys((state.values as any) || {})"
          @update:model-value="(v: any) => state.values = v"
        />
      </UFormField>

      <!-- Description -->
      <UFormField
        :label="t('admin.translations.description')"
        name="description"
      >
        <UTextarea
          v-model="state.description"
          :placeholder="t('admin.translations.descriptionPlaceholder')"
          :rows="3"
        />
      </UFormField>

      <!-- Form Actions -->
      <div class="flex gap-3 justify-end pt-4">
        <UButton
          color="neutral"
          variant="soft"
          @click="close()"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          type="submit"
          color="primary"
          :loading="loading !== 'notLoading'"
          :disabled="loading !== 'notLoading'"
        >
          {{ action === 'create' ? t('common.create') : t('common.update') }}
        </UButton>
      </div>
    </UForm>
  </div>
</template>

<script setup lang="ts">
import { translationsUiSchema, TRANSLATIONS_UI_DEFAULTS } from '../composables/useTranslationsUi'

const { t } = useT()

const props = defineProps<{
  action: 'create' | 'update' | 'delete'
  activeItem?: any
  loading?: string
  collection: string
}>()

const { close, ...crouton } = useCrouton()
const send = (crouton as any).send

// Form state
const state = ref({
  ...TRANSLATIONS_UI_DEFAULTS,
  ...(props.activeItem || {})
})

// Update state when activeItem changes
watch(() => props.activeItem, (newItem) => {
  if (newItem) {
    state.value = {
      ...TRANSLATIONS_UI_DEFAULTS,
      ...newItem
    }
  }
}, { immediate: true })

const schema = translationsUiSchema

const handleSubmit = () => {
  send(props.action, props.collection, state.value)
}

const handleDelete = () => {
  send(props.action, props.collection, [props.activeItem?.id])
}
</script>
