<script setup lang="ts">
import { slugify } from '../../shared/utils/slugify'

/**
 * TranslatableOptionItem - Repeater item for translatable dropdown options
 *
 * Used with FormRepeater for fields like statuses, groups, categories that need
 * both a value (slug) and translatable labels.
 *
 * Data structure:
 * {
 *   id: string,
 *   label: string,      // Default label (English)
 *   value: string,      // Slug/key for the option
 *   translations?: {    // Optional translations for label
 *     label: { nl: "Dutch", fr: "French", ... }
 *   }
 * }
 */

interface OptionItemData {
  id: string
  label: string
  value: string
  translations?: {
    label?: Record<string, string>
  }
}

const props = defineProps<{
  modelValue: OptionItemData
}>()

const emit = defineEmits<{
  'update:modelValue': [value: OptionItemData]
}>()

const { t, locale, locales, defaultLocale } = useI18n()

// The base/required locale: its value lives in the root `label` field, while
// other locales live in `translations.label[code]`. Driven by the configured
// i18n defaultLocale (was hardcoded 'en') so single-locale apps work correctly.
const requiredLocale = computed<string>(() => {
  const codes = locales.value.map(l => typeof l === 'string' ? l : l.code)
  const def = unref(defaultLocale)
  return (def && codes.includes(def)) ? def : (codes[0] ?? def ?? 'en')
})

// Track which locale we're editing
const editingLocale = ref(locale.value)

// Local state synced with modelValue
const label = computed({
  get: () => props.modelValue?.label || '',
  set: (val: string) => {
    emit('update:modelValue', {
      ...props.modelValue,
      label: val,
      // Auto-generate value from label if value is empty
      value: props.modelValue?.value || slugify(val)
    })
  }
})

const value = computed({
  get: () => props.modelValue?.value || '',
  set: (val: string) => {
    emit('update:modelValue', {
      ...props.modelValue,
      value: val
    })
  }
})

// Get translation for current editing locale
function getTranslation(localeCode: string): string {
  if (localeCode === requiredLocale.value) {
    return props.modelValue?.label || ''
  }
  return props.modelValue?.translations?.label?.[localeCode] || ''
}

// Set translation for a specific locale
function setTranslation(localeCode: string, val: string) {
  if (localeCode === requiredLocale.value) {
    // Base locale is stored in the main label field
    emit('update:modelValue', {
      ...props.modelValue,
      label: val
    })
  } else {
    // Other languages stored in translations
    const currentTranslations = props.modelValue?.translations || {}
    const labelTranslations = { ...(currentTranslations.label || {}) }

    if (val) {
      labelTranslations[localeCode] = val
    } else {
      delete labelTranslations[localeCode]
    }

    emit('update:modelValue', {
      ...props.modelValue,
      translations: {
        ...currentTranslations,
        label: labelTranslations
      }
    })
  }
}

// Check if a locale has a translation
function hasTranslation(localeCode: string): boolean {
  if (localeCode === requiredLocale.value) {
    return !!(props.modelValue?.label?.trim())
  }
  return !!(props.modelValue?.translations?.label?.[localeCode]?.trim())
}

// Auto-generate value from label when label changes (if value is empty or matches old slug)
const previousLabelSlug = ref(slugify(props.modelValue?.label || ''))

watch(() => props.modelValue?.label, (newLabel) => {
  if (!newLabel) return

  const newSlug = slugify(newLabel)
  const currentValue = props.modelValue?.value || ''

  // Auto-update value if it's empty or matches the previous auto-generated slug
  if (!currentValue || currentValue === previousLabelSlug.value) {
    emit('update:modelValue', {
      ...props.modelValue,
      value: newSlug
    })
  }

  previousLabelSlug.value = newSlug
})
</script>

<template>
  <div class="space-y-3">
    <!-- Language selector -->
    <div class="flex items-center gap-1">
      <UButton
        v-for="loc in locales"
        :key="typeof loc === 'string' ? loc : loc.code"
        :variant="editingLocale === (typeof loc === 'string' ? loc : loc.code) ? 'solid' : 'ghost'"
        :color="editingLocale === (typeof loc === 'string' ? loc : loc.code) ? 'primary' : 'neutral'"
        size="xs"
        @click="editingLocale = typeof loc === 'string' ? loc : loc.code"
      >
        <span class="flex items-center gap-1">
          {{ (typeof loc === 'string' ? loc : loc.code).toUpperCase() }}
          <UIcon
            v-if="hasTranslation(typeof loc === 'string' ? loc : loc.code)"
            name="i-lucide-check"
            class="w-3 h-3 text-success"
          />
        </span>
      </UButton>
    </div>

    <!-- Label input (translatable) -->
    <UFormField
      :label="`${t('options.labelForLocale', { locale: editingLocale.toUpperCase() })}${editingLocale === requiredLocale ? ' *' : ''}`"
      :required="editingLocale === requiredLocale"
    >
      <UInput
        :model-value="getTranslation(editingLocale)"
        :placeholder="editingLocale !== requiredLocale && getTranslation(requiredLocale)
          ? t('options.fallbackValue', { value: getTranslation(requiredLocale) })
          : t('options.displayName')"
        class="w-full"
        @update:model-value="setTranslation(editingLocale, $event)"
      />
      <template v-if="editingLocale !== requiredLocale && getTranslation(requiredLocale)" #hint>
        <span class="text-xs text-muted">{{ requiredLocale.toUpperCase() }}: {{ getTranslation(requiredLocale) }}</span>
      </template>
    </UFormField>

    <!-- Value input (slug, not translatable) -->
    <UFormField
      v-if="editingLocale === requiredLocale"
      :label="t('options.valueField')"
    >
      <UInput
        v-model="value"
        :placeholder="slugify(label) || t('options.valuePlaceholder')"
        class="w-full"
      />
      <template #hint>
        <span class="text-xs text-muted">
          {{ t('options.valueHint') }}
        </span>
      </template>
    </UFormField>
  </div>
</template>
