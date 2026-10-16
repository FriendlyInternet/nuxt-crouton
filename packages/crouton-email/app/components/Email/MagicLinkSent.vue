<script setup lang="ts">
/**
 * MagicLinkSent Component
 *
 * "Check your email for magic link" message with resend option.
 * Shows email address with option to change and resend functionality.
 *
 * @example
 * ```vue
 * <EmailMagicLinkSent
 *   :email="userEmail"
 *   @resend="handleResend"
 *   @change-email="handleChangeEmail"
 * />
 * ```
 */
import { ref } from 'vue'
import { useTimeoutFn } from '@vueuse/core'

const { t } = useT()

interface Props {
  /** Email address where magic link was sent */
  email: string
  /** Resend cooldown in seconds (default: 60) */
  resendCooldown?: number
  /** Loading state while resending */
  loading?: boolean
  /** External error message */
  error?: string
}

withDefaults(defineProps<Props>(), {
  resendCooldown: 60,
  loading: false,
  error: ''
})

const emit = defineEmits<{
  /** Emitted when resend is requested */
  'resend': []
  /** Emitted when user wants to change email */
  'change-email': []
}>()

// Local state
const isResending = ref(false)
const { start: resetResending } = useTimeoutFn(() => { isResending.value = false }, 1000, { immediate: false })

// Handle resend
async function handleResend() {
  isResending.value = true
  emit('resend')
  resetResending()
}

// Handle change email
function handleChangeEmail() {
  emit('change-email')
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header with email icon -->
    <div class="text-center">
      <div class="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
        <UIcon
          name="i-lucide-wand-2"
          class="w-8 h-8 text-primary"
        />
      </div>
      <h2 class="text-xl font-semibold text-default">
        {{ t('email.checkYourEmail') }}
      </h2>
      <p class="text-sm text-muted mt-2">
        {{ t('email.magicLinkSentTo') }}
      </p>
    </div>

    <!-- Email display -->
    <div class="bg-muted/50 rounded-lg p-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
            <UIcon
              name="i-lucide-mail"
              class="w-5 h-5 text-primary"
            />
          </div>
          <span class="font-medium text-default">{{ email }}</span>
        </div>
        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          icon="i-lucide-pencil"
          @click="handleChangeEmail"
        >
          {{ t('common.edit') }}
        </UButton>
      </div>
    </div>

    <!-- Error message -->
    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-alert-circle"
      :title="error"
    />

    <!-- Instructions -->
    <div class="space-y-3">
      <p class="text-sm text-muted text-center">
        {{ t('email.magicLinkInstructions') }}
      </p>

      <!-- Resend section -->
      <div class="flex items-center justify-center gap-1 text-sm text-muted">
        <span>{{ t('email.noEmailReceived') }}</span>
        <EmailResendButton
          :cooldown="resendCooldown"
          :loading="loading || isResending"
          @resend="handleResend"
        />
      </div>
    </div>

    <!-- Help tips -->
    <div class="bg-muted/30 rounded-lg p-4 space-y-2">
      <p class="text-xs font-medium text-default">
        {{ t('email.tips') }}
      </p>
      <ul class="text-xs text-muted space-y-1 list-disc list-inside">
        <li>{{ t('email.tipSpam') }}</li>
        <li>{{ t('email.tipCorrectAddress') }}</li>
        <li>{{ t('email.tipLinkExpires') }}</li>
      </ul>
    </div>

    <!-- Back button -->
    <UButton
      block
      variant="ghost"
      color="neutral"
      icon="i-lucide-arrow-left"
      @click="handleChangeEmail"
    >
      {{ t('email.tryDifferentEmail') }}
    </UButton>
  </div>
</template>
