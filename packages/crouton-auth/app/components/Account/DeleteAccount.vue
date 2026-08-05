<script setup lang="ts">
/**
 * Delete Account Component
 *
 * Allows users to permanently delete their account.
 * Requires password confirmation and typing to confirm.
 *
 * @example
 * ```vue
 * <AccountDeleteAccount />
 * ```
 */
interface Props {
  /** External loading state */
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false
})

const emit = defineEmits<{
  /** Emitted when account is deleted */
  deleted: []
}>()

const { t } = useT()
const { user, logout } = useAuth()
const notify = useNotify()

// Get auth client
function useAuthClient() {
  const nuxtApp = useNuxtApp()
  return nuxtApp.$authClient as ReturnType<typeof import('better-auth/vue').createAuthClient>
}
const authClient = useAuthClient()

// Modal state
const showModal = ref(false)

// Form state
const password = ref('')
const confirmText = ref('')

// Loading state
const deleteLoading = ref(false)
const isLoading = computed(() => props.loading || deleteLoading.value)

// Confirmation text required
const confirmationRequired = 'delete my account'
const isConfirmed = computed(() => {
  return confirmText.value.toLowerCase() === confirmationRequired
})

// Handle delete
async function handleDelete() {
  if (!isConfirmed.value || !password.value) return

  deleteLoading.value = true
  try {
    const result = await authClient.deleteUser({
      password: password.value
    })

    if (result.error) {
      throw new Error(result.error.message ?? 'Failed to delete account')
    }

    notify.success('Account deleted', { description: 'Your account has been permanently deleted.' })

    // Sign out and redirect
    await logout()
    emit('deleted')
    await navigateTo('/')
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Failed to delete account'
    notify.error('Error', { description: message })
  } finally {
    deleteLoading.value = false
  }
}

// Reset form on modal close
watch(showModal, (open) => {
  if (!open) {
    password.value = ''
    confirmText.value = ''
  }
})
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-lg font-semibold text-error">
        {{ t('account.deleteAccount') }}
      </h3>
      <p class="text-sm text-muted mt-1">
        {{ t('account.deleteAccountDescription') }}
      </p>
    </div>

    <UAlert
      color="error"
      variant="soft"
      icon="i-lucide-alert-triangle"
    >
      <template #title>
        {{ t('confirmation.cannotUndo') }}
      </template>
      <template #description>
        <p>{{ t('account.deleteAccountWillPrefix') }}</p>
        <ul class="list-disc list-inside mt-2 space-y-1">
          <li>{{ t('account.deleteWillRemoveData') }}</li>
          <li>{{ t('account.deleteWillCancelSubscriptions') }}</li>
          <li>{{ t('account.deleteWillRemoveFromTeams') }}</li>
          <li>{{ t('account.deleteWillDeleteContent') }}</li>
        </ul>
      </template>
    </UAlert>

    <UButton
      color="error"
      variant="soft"
      icon="i-lucide-trash-2"
      @click="showModal = true"
    >
      {{ t('account.deleteMyAccount') }}
    </UButton>

    <!-- Delete Confirmation Modal -->
    <UModal v-model:open="showModal">
      <template #content>
        <div class="p-6 space-y-6">
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center size-10 rounded-full bg-error/10">
              <UIcon
                name="i-lucide-alert-triangle"
                class="size-5 text-error"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold">
                {{ t('account.deleteAccount') }}
              </h3>
              <p class="text-sm text-muted">
                {{ t('account.deleteAccountPermanent') }}
              </p>
            </div>
          </div>

          <UAlert
            color="error"
            variant="soft"
            icon="i-lucide-alert-circle"
          >
            <template #description>
              <p>{{ t('account.aboutToDeleteAccount') }}</p>
              <p class="font-semibold mt-1">
                {{ user?.email }}
              </p>
            </template>
          </UAlert>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-2">
                {{ t('account.enterYourPasswordLabel') }}
              </label>
              <UInput
                v-model="password"
                type="password"
                :placeholder="t('auth.password')"
                icon="i-lucide-lock"
                :disabled="isLoading"
              />
            </div>

            <div>
              <label class="block text-sm font-medium mb-2">
                {{ t('account.typeToConfirmPrefix') }} <strong class="font-mono text-error">{{ confirmationRequired }}</strong> {{ t('account.typeToConfirmSuffix') }}
              </label>
              <UInput
                v-model="confirmText"
                :placeholder="confirmationRequired"
                :disabled="isLoading"
                class="font-mono"
              />
            </div>
          </div>

          <div class="flex justify-end gap-3">
            <UButton
              variant="ghost"
              :disabled="isLoading"
              @click="showModal = false"
            >
              {{ t('common.cancel') }}
            </UButton>
            <UButton
              color="error"
              :loading="isLoading"
              :disabled="!isConfirmed || !password"
              icon="i-lucide-trash-2"
              @click="handleDelete"
            >
              {{ t('account.deleteAccount') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
