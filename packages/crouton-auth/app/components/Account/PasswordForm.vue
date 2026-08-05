<script setup lang="ts">
/**
 * Password Form Component
 *
 * Form for changing user password.
 * Requires current password and new password confirmation.
 *
 * @example
 * ```vue
 * <AccountPasswordForm @saved="onSaved" />
 * ```
 */
import type { FormSubmitEvent, FormError } from '@nuxt/ui'

const { t } = useT()

interface Props {
  /** External loading state */
  loading?: boolean
  /** External error message */
  error?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  error: null
})

const emit = defineEmits<{
  /** Emitted when password is changed */
  saved: []
}>()

const notify = useNotify()

// Get auth client for password change
function useAuthClient() {
  const nuxtApp = useNuxtApp()
  return nuxtApp.$authClient as ReturnType<typeof import('better-auth/vue').createAuthClient>
}
const authClient = useAuthClient()

// Form state
const state = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})

// Validation
function validate(formState: Partial<typeof state>): FormError[] {
  const errors: FormError[] = []

  if (!formState.currentPassword?.trim()) {
    errors.push({ name: 'currentPassword', message: t('errors.requiredField') })
  }

  if (!formState.newPassword?.trim()) {
    errors.push({ name: 'newPassword', message: t('errors.requiredField') })
  } else if (formState.newPassword.length < 8) {
    errors.push({ name: 'newPassword', message: t('errors.minLength', { params: { min: 8 } }) })
  }

  if (!formState.confirmPassword?.trim()) {
    errors.push({ name: 'confirmPassword', message: t('errors.requiredField') })
  } else if (formState.newPassword !== formState.confirmPassword) {
    errors.push({ name: 'confirmPassword', message: t('errors.passwordMismatch') })
  }

  return errors
}

// Internal loading state
const internalLoading = ref(false)
const isLoading = computed(() => props.loading || internalLoading.value)

// Handle form submission
async function onSubmit(event: FormSubmitEvent<typeof state>) {
  internalLoading.value = true
  try {
    const result = await authClient.changePassword({
      currentPassword: event.data.currentPassword,
      newPassword: event.data.newPassword
    })

    if (result.error) {
      throw new Error(result.error.message ?? t('account.passwordChangeFailed'))
    }

    notify.success(t('account.passwordUpdated'), { description: t('account.passwordChangedDescription') })

    // Clear form
    state.currentPassword = ''
    state.newPassword = ''
    state.confirmPassword = ''

    emit('saved')
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('account.passwordChangeFailed')
    notify.error(t('common.error'), { description: message })
  } finally {
    internalLoading.value = false
  }
}

// Reset form
function resetForm() {
  state.currentPassword = ''
  state.newPassword = ''
  state.confirmPassword = ''
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-lg font-semibold">
        {{ t('auth.changePassword') }}
      </h3>
      <p class="text-sm text-muted mt-1">
        {{ t('account.passwordDescription') }}
      </p>
    </div>

    <UForm
      :validate="validate"
      :state="state"
      class="space-y-6"
      @submit="onSubmit"
    >
      <UFormField
        :label="t('auth.currentPassword')"
        name="currentPassword"
        required
        class="w-full"
      >
        <UInput
          v-model="state.currentPassword"
          type="password"
          :placeholder="$t('auth.placeholders.currentPassword')"
          icon="i-lucide-lock"
          :disabled="isLoading"
          class="w-full"
        />
      </UFormField>

      <USeparator />

      <UFormField
        :label="t('auth.newPassword')"
        name="newPassword"
        required
        class="w-full"
      >
        <template #hint>
          <span class="text-xs text-muted">{{ $t('auth.placeholders.atLeastChars', { min: 8 }) }}</span>
        </template>
        <UInput
          v-model="state.newPassword"
          type="password"
          :placeholder="$t('auth.placeholders.newPassword')"
          icon="i-lucide-key"
          :disabled="isLoading"
          class="w-full"
        />
      </UFormField>

      <UFormField
        :label="t('auth.confirmPassword')"
        name="confirmPassword"
        required
        class="w-full"
      >
        <UInput
          v-model="state.confirmPassword"
          type="password"
          :placeholder="$t('auth.placeholders.confirmPassword')"
          icon="i-lucide-key"
          :disabled="isLoading"
          class="w-full"
        />
      </UFormField>

      <!-- Error Alert -->
      <UAlert
        v-if="error"
        color="error"
        icon="i-lucide-alert-circle"
        :title="error"
      />

      <div class="flex justify-end gap-3">
        <UButton
          variant="ghost"
          :disabled="isLoading"
          @click="resetForm"
        >
          {{ t('common.reset') }}
        </UButton>
        <UButton
          type="submit"
          :loading="isLoading"
        >
          {{ t('account.updatePassword') }}
        </UButton>
      </div>
    </UForm>
  </div>
</template>
