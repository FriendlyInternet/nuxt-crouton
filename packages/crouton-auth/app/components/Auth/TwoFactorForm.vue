<script setup lang="ts">
/**
 * TwoFactorForm Component
 *
 * Form for two-factor authentication verification.
 * Supports TOTP codes and backup codes.
 *
 * @example
 * ```vue
 * <AuthTwoFactorForm @success="onVerified" />
 * ```
 */
import type { FormSubmitEvent, FormError } from '@nuxt/ui'

const { t } = useT()

interface Props {
  /** Show loading state */
  loading?: boolean
  /** External error message to display */
  error?: string | null
  /** Show trust device option */
  showTrustDevice?: boolean
  /** Initial mode */
  initialMode?: 'totp' | 'backup'
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  error: null,
  showTrustDevice: true,
  initialMode: 'totp'
})

const emit = defineEmits<{
  /** Emitted when TOTP code is submitted */
  submitTotp: [data: { code: string, trustDevice: boolean }]
  /** Emitted when backup code is submitted */
  submitBackup: [code: string]
}>()

// Current mode
const mode = ref<'totp' | 'backup'>(props.initialMode)

// Form state
const state = reactive({
  code: '',
  trustDevice: false
})

// Validation
function validate(formState: Partial<typeof state>): FormError[] {
  const errors: FormError[] = []
  if (!formState.code) {
    errors.push({ name: 'code', message: t('errors.requiredField') })
  } else if (mode.value === 'totp' && !/^\d{6}$/.test(formState.code)) {
    errors.push({ name: 'code', message: t('auth.twoFactor.enter6DigitCode') })
  } else if (mode.value === 'backup' && formState.code.length < 8) {
    errors.push({ name: 'code', message: t('auth.twoFactor.enterValidBackupCode') })
  }
  return errors
}

// Handle form submission
function onSubmit(event: FormSubmitEvent<typeof state>) {
  if (mode.value === 'totp') {
    emit('submitTotp', {
      code: event.data.code,
      trustDevice: event.data.trustDevice
    })
  } else {
    emit('submitBackup', event.data.code)
  }
}

// Toggle mode
function toggleMode() {
  mode.value = mode.value === 'totp' ? 'backup' : 'totp'
  state.code = ''
}
</script>

<template>
  <div>
    <UForm
      :validate="validate"
      :state="state"
      class="space-y-6"
      @submit="onSubmit"
    >
      <!-- TOTP Mode -->
      <template v-if="mode === 'totp'">
        <UFormField
          :label="$t('auth.twoFactor.authenticationCode')"
          name="code"
        >
          <UInput
            v-model="state.code"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="6"
            placeholder="000000"
            autocomplete="one-time-code"
            icon="i-lucide-key-round"
            class="font-mono tracking-widest"
          />
        </UFormField>
        <p class="text-sm text-muted">
          {{ $t('auth.twoFactor.authenticatorDescription') }}
        </p>

        <UCheckbox
          v-if="showTrustDevice"
          v-model="state.trustDevice"
          :label="$t('auth.twoFactor.trustDevice')"
        />
      </template>

      <!-- Backup Code Mode -->
      <template v-else>
        <UFormField
          :label="$t('auth.twoFactor.backupCode')"
          name="code"
        >
          <UInput
            v-model="state.code"
            type="text"
            :placeholder="$t('auth.twoFactor.enterBackupCode')"
            autocomplete="off"
            icon="i-lucide-shield"
            class="font-mono"
          />
        </UFormField>
        <p class="text-sm text-muted">
          {{ $t('auth.twoFactor.backupCodeDescription') }}
        </p>
      </template>

      <!-- Error Alert -->
      <UAlert
        v-if="error"
        color="error"
        icon="i-lucide-alert-circle"
        :title="error"
      />

      <UButton
        type="submit"
        block
        :loading="loading"
      >
        {{ t('auth.verify') }}
      </UButton>

      <!-- Toggle Mode — UButton so themes reach it (#1410) -->
      <div class="text-center">
        <UButton
          variant="link"
          size="md"
          class="p-0"
          @click="toggleMode"
        >
          {{ mode === 'totp' ? $t('auth.twoFactor.useBackupCode') : $t('auth.twoFactor.useAuthenticatorApp') }}
        </UButton>
      </div>
    </UForm>
  </div>
</template>
