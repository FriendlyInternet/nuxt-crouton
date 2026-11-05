<script setup lang="ts">
/**
 * EmailVerificationFlow Component
 *
 * Complete verification code input flow with resend functionality.
 * Shows "Check your email" message with code input and resend button.
 *
 * @example
 * ```vue
 * <EmailVerificationFlow
 *   :email="userEmail"
 *   @verified="handleVerified"
 *   @resend="handleResend"
 *   @error="handleError"
 * />
 * ```
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'

const { t } = useT()

interface Props {
  /** Email address being verified */
  email: string
  /** Length of verification code (default: 6) */
  codeLength?: number
  /** Resend cooldown in seconds (default: 60) */
  resendCooldown?: number
  /** Loading state while verifying */
  loading?: boolean
  /** External error message */
  error?: string
}

const props = withDefaults(defineProps<Props>(), {
  codeLength: 6,
  resendCooldown: 60,
  loading: false,
  error: ''
})

const emit = defineEmits<{
  /** Emitted when code is submitted */
  verified: [code: string]
  /** Emitted when resend is requested */
  resend: []
  /** Emitted when an error occurs */
  error: [error: string]
}>()

// Code input state
const code = ref('')
const codeInput = ref<HTMLInputElement | null>(null)
const isResending = ref(false)

// Code is complete when it matches expected length
const isCodeComplete = computed(() => {
  return code.value.length === props.codeLength
})

// Handle code input - only allow digits
function handleCodeInput(event: Event) {
  const target = event.target as HTMLInputElement
  // Filter to only digits
  const filtered = target.value.replace(/\D/g, '').slice(0, props.codeLength)
  code.value = filtered
  target.value = filtered

  // Auto-submit when complete
  if (filtered.length === props.codeLength) {
    handleSubmit()
  }
}

// Handle paste
function handlePaste(event: ClipboardEvent) {
  event.preventDefault()
  const pasted = event.clipboardData?.getData('text') || ''
  const filtered = pasted.replace(/\D/g, '').slice(0, props.codeLength)
  code.value = filtered

  // Auto-submit when complete
  if (filtered.length === props.codeLength) {
    handleSubmit()
  }
}

// Handle submit
function handleSubmit() {
  if (!isCodeComplete.value || props.loading) return
  emit('verified', code.value)
}

// Handle resend
async function handleResend() {
  isResending.value = true
  emit('resend')
  // Reset resending state after a short delay (parent should update)
  setTimeout(() => {
    isResending.value = false
  }, 1000)
}

// Focus input on mount
onMounted(() => {
  nextTick(() => {
    codeInput.value?.focus()
  })
})

// Clear code when email changes
watch(() => props.email, () => {
  code.value = ''
})

// Expose methods
function reset() {
  code.value = ''
  codeInput.value?.focus()
}

function focus() {
  codeInput.value?.focus()
}

defineExpose({ reset, focus })
</script>

<template>
  <div class="space-y-6">
    <!-- Header with email icon -->
    <div class="text-center">
      <div class="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
        <UIcon
          name="i-lucide-mail-check"
          class="w-8 h-8 text-primary"
        />
      </div>
      <h2 class="text-xl font-semibold text-default">
        {{ t('email.checkYourEmail') }}
      </h2>
      <p class="text-sm text-muted mt-2">
        {{ t('email.codeSentTo') }}
        <span class="font-medium text-default">{{ email }}</span>
      </p>
    </div>

    <!-- Code input -->
    <div class="space-y-2">
      <label class="text-sm font-medium text-default">
        {{ t('email.verificationCode') }}
      </label>
      <UInput
        ref="codeInput"
        :model-value="code"
        type="text"
        inputmode="numeric"
        :maxlength="codeLength"
        :placeholder="'0'.repeat(codeLength)"
        autocomplete="one-time-code"
        class="font-mono tracking-[0.5em] text-center text-xl"
        :color="error ? 'error' : undefined"
        @input="handleCodeInput"
        @paste="handlePaste"
        @keydown.enter="handleSubmit"
      />
    </div>

    <!-- Error message -->
    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-alert-circle"
      :title="error"
    />

    <!-- Submit button -->
    <UButton
      block
      :disabled="!isCodeComplete"
      :loading="loading"
      @click="handleSubmit"
    >
      {{ t('email.verifyEmail') }}
    </UButton>

    <!-- Resend section -->
    <div class="flex items-center justify-center gap-1 text-sm text-muted">
      <span>{{ t('email.noCodeReceived') }}</span>
      <EmailResendButton
        :cooldown="resendCooldown"
        :loading="isResending"
        @resend="handleResend"
      />
    </div>

    <!-- Help text -->
    <p class="text-xs text-center text-muted">
      {{ t('email.checkSpamHint') }}
    </p>
  </div>
</template>
