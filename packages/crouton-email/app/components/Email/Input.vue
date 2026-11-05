<script setup lang="ts">
/**
 * EmailInput Component
 *
 * Email input field with real-time validation.
 * Uses Nuxt UI UInput with email validation.
 *
 * @example
 * ```vue
 * <EmailInput
 *   v-model="email"
 *   :error="emailError"
 *   placeholder="Enter your email"
 * />
 * ```
 */
import { ref, computed, watch } from 'vue'

const { t } = useT()

interface Props {
  /** Email value (v-model) */
  modelValue?: string
  /** External error message */
  error?: string
  /** Input placeholder */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Autofocus on mount */
  autofocus?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  error: '',
  placeholder: 'you@example.com',
  disabled: false,
  autofocus: false
})

const emit = defineEmits<{
  /** Email value changed */
  'update:modelValue': [email: string]
  /** Validation state changed */
  'valid': [isValid: boolean]
}>()

// Local state
const localValue = ref(props.modelValue)
const touched = ref(false)

// Sync with prop
watch(() => props.modelValue, (val) => {
  localValue.value = val
})

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/

// Validation state
const isValid = computed(() => {
  if (!localValue.value) return false
  return EMAIL_REGEX.test(localValue.value)
})

// Internal error message
const internalError = computed(() => {
  if (!touched.value) return ''
  if (!localValue.value) return t('email.emailRequired')
  if (!isValid.value) return t('email.invalidEmail')
  return ''
})

// Combined error (external takes priority)
const displayError = computed(() => {
  return props.error || internalError.value
})

// Handle input changes
function handleInput(event: Event) {
  const target = event.target as HTMLInputElement
  localValue.value = target.value
  emit('update:modelValue', target.value)
}

// Handle blur for touched state
function handleBlur() {
  touched.value = true
  emit('valid', isValid.value)
}

// Watch validation state
watch(isValid, (valid) => {
  if (touched.value) {
    emit('valid', valid)
  }
})

// Expose validation method
function validate(): boolean {
  touched.value = true
  emit('valid', isValid.value)
  return isValid.value
}

defineExpose({ validate, isValid })
</script>

<template>
  <UFormField :error="displayError">
    <UInput
      :model-value="localValue"
      type="email"
      :placeholder="placeholder"
      :disabled="disabled"
      :autofocus="autofocus"
      autocomplete="email"
      icon="i-lucide-mail"
      :color="displayError ? 'error' : undefined"
      @input="handleInput"
      @blur="handleBlur"
    />
  </UFormField>
</template>
