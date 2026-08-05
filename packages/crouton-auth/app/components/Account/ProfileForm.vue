<script setup lang="ts">
/**
 * Profile Form Component
 *
 * Form for updating user profile information (name, avatar).
 *
 * @example
 * ```vue
 * <AccountProfileForm @saved="onSaved" />
 * ```
 */
import type { FormSubmitEvent, FormError } from '@nuxt/ui'
import { requireAuthClient } from '../../../types/auth-client'

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
  /** Emitted when profile is saved */
  saved: []
}>()

const { user, refreshSession } = useAuth()
const notify = useNotify()


// Form state (populated from current user)
const state = reactive({
  name: '',
  email: '',
  image: ''
})

// Populate form when user changes
watch(
  () => user.value,
  (u) => {
    if (u) {
      state.name = u.name ?? ''
      state.email = u.email ?? ''
      state.image = u.image ?? ''
    }
  },
  { immediate: true }
)

// Track if form has changes
const emailChanged = computed(() => {
  if (!user.value) return false
  return state.email !== (user.value.email ?? '')
})

const hasChanges = computed(() => {
  if (!user.value) return false
  return (
    state.name !== (user.value.name ?? '')
    || state.email !== (user.value.email ?? '')
    || state.image !== (user.value.image ?? '')
  )
})

// Validation
function validate(formState: Partial<typeof state>): FormError[] {
  const errors: FormError[] = []

  if (!formState.name?.trim()) {
    errors.push({ name: 'name', message: t('errors.requiredField') })
  } else if (formState.name.length < 2) {
    errors.push({ name: 'name', message: t('errors.minLength', { params: { min: 2 } }) })
  } else if (formState.name.length > 100) {
    errors.push({ name: 'name', message: t('errors.maxLength', { params: { max: 100 } }) })
  }

  if (formState.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formState.email)) {
    errors.push({ name: 'email', message: t('errors.invalidEmail') || 'Please enter a valid email address' })
  }

  if (formState.image && !/^(https?|blob):\/\//.test(formState.image)) {
    errors.push({ name: 'image', message: t('account.avatarInvalidUrl') })
  }

  return errors
}

// Handle avatar file upload
async function handleAvatarUpload(file: File | null) {
  if (!file) {
    state.image = ''
    return
  }
  try {
    const formData = new FormData()
    formData.append('file', file)
    const result = await $fetch<{ url: string }>('/api/upload-image', {
      method: 'POST',
      body: formData
    })
    if (result?.url) {
      state.image = result.url
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('account.failedToUploadAvatar')
    notify.error(t('account.uploadFailed'), { description: message })
  }
}

// Internal loading state
const internalLoading = ref(false)
const isLoading = computed(() => props.loading || internalLoading.value)

// Handle form submission
async function onSubmit(event: FormSubmitEvent<typeof state>) {
  internalLoading.value = true
  try {
    // Update name and image
    const result = await requireAuthClient().updateUser({
      name: event.data.name,
      image: event.data.image || undefined
    })

    if (result.error) {
      throw new Error(result.error.message ?? 'Update failed')
    }

    // Handle email change separately (sends verification)
    if (emailChanged.value && event.data.email) {
      const emailResult = await requireAuthClient().changeEmail({
        newEmail: event.data.email,
        callbackURL: window.location.href
      })

      if (emailResult.error) {
        throw new Error(emailResult.error.message ?? 'Email change failed')
      }

      notify.success(
        t('account.emailChangeRequested') || 'Verification email sent',
        { description: t('account.emailChangeDescription') || `A verification email has been sent to ${event.data.email}. Please check your inbox.` }
      )
    }

    await refreshSession()

    notify.success(t('account.profileUpdated'), { description: t('account.profileSavedDescription') })

    emit('saved')
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('account.failedToUpdateProfile')
    notify.error(t('common.error'), { description: message })
  } finally {
    internalLoading.value = false
  }
}

// Reset form to current user values
function resetForm() {
  if (user.value) {
    state.name = user.value.name ?? ''
    state.email = user.value.email ?? ''
    state.image = user.value.image ?? ''
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-lg font-semibold">
        {{ t('account.profile') }}
      </h3>
      <p class="text-sm text-muted mt-1">
        {{ t('account.profileDescription') }}
      </p>
    </div>

    <UForm
      :validate="validate"
      :state="state"
      class="space-y-6"
      @submit="onSubmit"
    >
      <!-- Avatar -->
      <UFormField
        :label="t('account.avatar') || 'Avatar'"
        name="image"
      >
        <div class="flex items-center gap-4">
          <CroutonImageUpload
            v-model="state.image"
            :crop="{ aspectRatio: 1, circular: true }"
            class="size-20 !rounded-full [&_button]:!rounded-full [&_button]:!h-20"
            @file-selected="handleAvatarUpload"
          />
          <div class="flex-1 min-w-0">
            <p class="font-medium truncate">
              {{ state.name || 'Your Name' }}
            </p>
            <p class="text-sm text-muted truncate">
              {{ state.email || user?.email }}
            </p>
          </div>
        </div>
      </UFormField>

      <USeparator />

      <UFormField
        :label="t('forms.name') || 'Display name'"
        name="name"
        required
        class="w-full"
      >
        <UInput
          v-model="state.name"
          :placeholder="$t('auth.placeholders.name')"
          icon="i-lucide-user"
          :disabled="isLoading"
          class="w-full"
        />
      </UFormField>

      <UFormField
        :label="t('forms.email') || 'Email'"
        name="email"
        class="w-full"
      >
        <template #hint>
          <span v-if="emailChanged" class="text-xs text-amber-500">
            {{ t('account.emailChangeHint') || 'A verification email will be sent to confirm the change.' }}
          </span>
        </template>
        <UInput
          v-model="state.email"
          type="email"
          :placeholder="$t('auth.placeholders.email')"
          icon="i-lucide-mail"
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
          :disabled="isLoading || !hasChanges"
          @click="resetForm"
        >
          {{ t('common.reset') }}
        </UButton>
        <UButton
          type="submit"
          :loading="isLoading"
          :disabled="!hasChanges"
        >
          {{ t('common.saveChanges') }}
        </UButton>
      </div>
    </UForm>
  </div>
</template>
