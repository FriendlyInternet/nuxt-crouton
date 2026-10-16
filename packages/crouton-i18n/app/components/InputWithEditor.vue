<script setup lang="ts">
const props = defineProps<{
  modelValue: Record<string, string> // The translations object { en: 'Hello', nl: 'Hallo' }
  fields: string[] // Fields to translate (for backwards compat, default to ['value'])
  label?: string
  error?: string | boolean // Validation error state
  useRichText?: boolean // Whether to use the rich text editor
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>]
}>()

const { locale, locales, defaultLocale } = useI18n()
const { t } = useT()

// The base/required locale — its tab is marked `*` and is the fallback source.
// Driven by the configured i18n defaultLocale (was hardcoded 'en') so
// single-locale apps (e.g. nl-only) mark the right tab required.
const requiredLocale = computed<string>(() => {
  const codes = locales.value.map(l => typeof l === 'string' ? l : l.code)
  const def = unref(defaultLocale)
  return (def && codes.includes(def)) ? def : (codes[0] ?? def ?? 'en')
})

// Track which locale we're editing
const editingLocale = ref(locale.value)
const showAllLanguages = ref(false)

// Current value for the editing locale
const currentValue = computed(() => {
  return props.modelValue?.[editingLocale.value] || ''
})

function updateValue(value: string, locale?: string) {
  const targetLocale = locale || editingLocale.value
  const updated = {
    ...props.modelValue,
    [targetLocale]: value
  }
  emit('update:modelValue', updated)
}

// Show completion status
const translationStatus = computed(() => {
  return locales.value.map((loc) => {
    const localeCode = typeof loc === 'string' ? loc : loc.code
    return {
      locale: localeCode,
      complete: !!props.modelValue?.[localeCode]
    }
  })
})
</script>

<template>
  <div class="space-y-4">
    <!-- Help text -->
    <div class="text-xs text-gray-500 dark:text-gray-400">
      <span class="text-red-500">*</span> {{ requiredLocale.toUpperCase() }} translation is required. Other languages are optional and will fallback to {{ requiredLocale.toUpperCase() }} if not provided.
    </div>

    <!-- Language selector with status indicators -->
    <div class="flex items-center justify-between">
      <UFieldGroup class="w-full">
        <UButton
          v-for="loc in locales"
          :key="typeof loc === 'string' ? loc : loc.code"
          :variant="editingLocale === (typeof loc === 'string' ? loc : loc.code) ? 'solid' : 'outline'"
          size="sm"
          class="w-full"
          @click="editingLocale = typeof loc === 'string' ? loc : loc.code"
        >
          <span class="flex items-center gap-2">
            {{ (typeof loc === 'string' ? loc : loc.code).toUpperCase() }}
            <span
              v-if="(typeof loc === 'string' ? loc : loc.code) === requiredLocale"
              class="text-red-500"
            >*</span>
            <UIcon
              v-if="translationStatus.find(s => s.locale === (typeof loc === 'string' ? loc : loc.code))?.complete"
              name="i-lucide-check-circle"
              class="text-green-500"
            />
          </span>
        </UButton>
      </UFieldGroup>
    </div>

    <!-- Single language edit mode -->
    <div
      v-if="!showAllLanguages"
      class="space-y-3"
    >
      <UFormField
        :label="`${t('i18n.input.translationLabel', { locale: editingLocale.toUpperCase() })}${editingLocale === requiredLocale ? ' *' : ''}`"
        :name="`values.${editingLocale}`"
        :required="editingLocale === requiredLocale"
      >
        <!-- Rich Text Editor for translation content -->
        <div
          v-if="useRichText"
          class="border rounded-lg overflow-hidden"
          :class="[
            error && editingLocale === requiredLocale && !currentValue ? 'border-red-500' : 'border-gray-300 dark:border-gray-700'
          ]"
        >
          <div class="h-64">
            <CroutonEditorSimple
              :model-value="currentValue"
              @update:model-value="updateValue($event)"
            />
          </div>
        </div>

        <!-- Regular Input (fallback) -->
        <UInput
          v-else
          :model-value="currentValue"
          :placeholder="editingLocale !== requiredLocale && modelValue?.[requiredLocale] ? t('i18n.input.fallback', { value: modelValue[requiredLocale] }) : ''"
          :color="error && editingLocale === requiredLocale && !currentValue ? 'error' : 'primary'"
          :highlight="!!(error && editingLocale === requiredLocale && !currentValue)"
          class="w-full"
          size="lg"
          @update:model-value="updateValue($event)"
        />
      </UFormField>

      <!-- Show original for reference when not editing the base locale -->
      <div
        v-if="editingLocale !== requiredLocale && modelValue?.[requiredLocale]"
        class="mt-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
      >
        <p class="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
          {{ requiredLocale.toUpperCase() }} reference:
        </p>
        <div
          v-if="useRichText"
          class="prose prose-sm dark:prose-invert max-w-none"
          v-html="modelValue[requiredLocale]"
        />
        <p
          v-else
          class="text-sm text-gray-700 dark:text-gray-300"
        >
          {{ modelValue[requiredLocale] }}
        </p>
      </div>
    </div>

    <!-- All languages grid mode (simplified for rich text) -->
    <div
      v-else
      class="space-y-4"
    >
      <p class="text-sm text-amber-600 dark:text-amber-400">
        <UIcon name="i-lucide-info" /> {{ t('i18n.input.gridModeUnavailable') }}
      </p>
    </div>
  </div>
</template>
