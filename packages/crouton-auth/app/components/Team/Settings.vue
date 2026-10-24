<script setup lang="ts">
/**
 * Team Settings Component
 *
 * Form to update team settings (name, slug, logo).
 * Only accessible to team owners and admins.
 *
 * @example
 * ```vue
 * <TeamSettings @saved="onSaved" />
 * ```
 */
import type { FormSubmitEvent, FormError } from '@nuxt/ui'
import type { Team } from '../../../types'

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
  /** Emitted when settings are saved */
  saved: [team: Team]
  /** Emitted when delete is requested */
  delete: []
}>()

const { t } = useT()
const { currentTeam, updateTeam, isOwner, isAdmin } = useTeam()
const notify = useNotify()

// Logo upload (#2259) — uploads straight away, saved with "Save Changes"
const isUploadingLogo = ref(false)
const logoPreview = computed({
  get: () => state.logo || undefined,
  set: () => {} // preview follows state.logo; uploads set it below
})

async function handleLogoSelected(file: File | null) {
  if (!file) {
    state.logo = ''
    return
  }
  isUploadingLogo.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    // /api/upload-image returns the blob pathname; images are served at /images/<pathname>
    const result = await $fetch<{ pathname: string }>('/api/upload-image', { method: 'POST', body: formData })
    if (result?.pathname) state.logo = `/images/${result.pathname}`
  }
  catch (e: unknown) {
    notify.error(t('common.error'), { description: e instanceof Error ? e.message : String(e) })
  }
  finally {
    isUploadingLogo.value = false
  }
}

// Form state (populated from current team)
const state = reactive({
  name: '',
  slug: '',
  logo: ''
})

// Populate form when team changes
watch(
  currentTeam,
  (team) => {
    if (team) {
      state.name = team.name
      state.slug = team.slug
      state.logo = team.logo ?? ''
    }
  },
  { immediate: true }
)

// Track if form has changes
const hasChanges = computed(() => {
  if (!currentTeam.value) return false
  return (
    state.name !== currentTeam.value.name
    || state.slug !== currentTeam.value.slug
    || state.logo !== (currentTeam.value.logo ?? '')
  )
})

// Validation
function validate(formState: Partial<typeof state>): FormError[] {
  const errors: FormError[] = []

  if (!formState.name?.trim()) {
    errors.push({ name: 'name', message: t('errors.requiredField') })
  } else if (formState.name.length < 2) {
    errors.push({ name: 'name', message: t('errors.minLength', { params: { min: 2 } }) })
  } else if (formState.name.length > 50) {
    errors.push({ name: 'name', message: t('errors.maxLength', { params: { max: 50 } }) })
  }

  if (!formState.slug?.trim()) {
    errors.push({ name: 'slug', message: t('errors.requiredField') })
  } else if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(formState.slug)) {
    errors.push({ name: 'slug', message: t('teams.slugValidation') })
  }

  // An uploaded logo is served from /images/…; a pasted one must be http(s)
  if (formState.logo && !/^(https?:\/\/|\/images\/)/.test(formState.logo)) {
    errors.push({ name: 'logo', message: t('teams.logoInvalidUrl') })
  }

  return errors
}

// Internal loading state
const internalLoading = ref(false)
const isLoading = computed(() => props.loading || internalLoading.value)

// Handle form submission
async function onSubmit(event: FormSubmitEvent<typeof state>) {
  if (!isAdmin.value) {
    notify.error(t('teams.permissionDenied'), { description: t('teams.permissionDeniedDescription') })
    return
  }

  internalLoading.value = true
  try {
    const team = await updateTeam({
      name: event.data.name,
      slug: event.data.slug,
      logo: event.data.logo || undefined
    })

    notify.success(t('teams.settingsSaved'), { description: t('teams.settingsSavedDescription') })

    emit('saved', team)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('teams.failedToSaveSettings')
    notify.error(t('common.error'), { description: message })
  } finally {
    internalLoading.value = false
  }
}

// Reset form to current team values
function resetForm() {
  if (currentTeam.value) {
    state.name = currentTeam.value.name
    state.slug = currentTeam.value.slug
    state.logo = currentTeam.value.logo ?? ''
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- Header -->
    <div>
      <h3 class="text-lg font-semibold">
        {{ t('teams.teamSettings') }}
      </h3>
      <p class="text-sm text-muted mt-1">
        {{ t('teams.teamSettingsDescription') }}
      </p>
    </div>

    <!-- Team Identity Preview -->
    <div class="flex items-center gap-4 p-4 rounded-lg bg-muted/40 border border-default">
      <UAvatar
        v-if="state.logo"
        :src="state.logo"
        :ui="{ image: 'object-contain' }"
        :as="{ img: 'img' }"
        :alt="state.name"
        size="xl"
      />
      <div
        v-else
        class="flex items-center justify-center size-14 rounded-full bg-muted shrink-0"
      >
        <UIcon
          name="i-lucide-building-2"
          class="size-7 text-muted-foreground"
        />
      </div>
      <div>
        <p class="font-semibold">
          {{ state.name || t('teams.teamName') }}
        </p>
        <p class="text-sm text-muted">
          /{{ state.slug || 'your-slug' }}
        </p>
      </div>
    </div>

    <UForm
      :validate="validate"
      :state="state"
      class="space-y-0 divide-y divide-default"
      @submit="onSubmit"
    >
      <!-- Team Name -->
      <div class="grid grid-cols-1 gap-4 py-6 sm:grid-cols-2 sm:gap-8">
        <div>
          <p class="font-medium text-sm">
            {{ t('teams.teamName') }} <span class="text-error">*</span>
          </p>
          <p class="text-sm text-muted mt-0.5">
            {{ t('teams.teamNamePlaceholder') }}
          </p>
        </div>
        <UFormField name="name" class="w-full">
          <UInput
            v-model="state.name"
            :placeholder="t('teams.teamNamePlaceholder')"
            icon="i-lucide-building-2"
            :disabled="isLoading || !isAdmin"
            class="w-full"
          />
        </UFormField>
      </div>

      <!-- URL Slug -->
      <div class="grid grid-cols-1 gap-4 py-6 sm:grid-cols-2 sm:gap-8">
        <div>
          <p class="font-medium text-sm">
            {{ t('teams.urlSlug') }} <span class="text-error">*</span>
          </p>
          <p class="text-sm text-muted mt-0.5">
            {{ t('teams.urlSlugHint') }}
          </p>
        </div>
        <UFormField name="slug" class="w-full">
          <UInput
            v-model="state.slug"
            :placeholder="$t('teams.yourSlug')"
            icon="i-lucide-link"
            :disabled="isLoading || !isAdmin"
            class="w-full"
          />
        </UFormField>
      </div>

      <!-- Logo -->
      <div class="grid grid-cols-1 gap-4 py-6 sm:grid-cols-2 sm:gap-8">
        <div>
          <p class="font-medium text-sm">
            {{ t('teams.logo') }}
          </p>
          <p class="text-sm text-muted mt-0.5">
            {{ t('teams.logoHint') }}
          </p>
        </div>
        <UFormField name="logo" class="w-full">
          <CroutonImageUpload
            v-model="logoPreview"
            fit="contain"
            :disabled="isLoading || isUploadingLogo || !isAdmin"
            class="w-full max-w-xs"
            @file-selected="handleLogoSelected"
          />
          <p v-if="isUploadingLogo" class="text-xs text-muted mt-2">
            {{ t('teams.logoUploading') }}
          </p>
        </UFormField>
      </div>

      <!-- Error Alert -->
      <UAlert
        v-if="error"
        color="error"
        icon="i-lucide-alert-circle"
        :title="error"
        class="mt-4"
      />

      <!-- Actions -->
      <div class="flex justify-between items-center pt-6">
        <UButton
          v-if="isOwner"
          variant="ghost"
          color="error"
          icon="i-lucide-trash-2"
          :disabled="isLoading"
          @click="emit('delete')"
        >
          {{ t('teams.deleteTeam') }}
        </UButton>
        <div v-else />

        <div class="flex gap-3">
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
            :disabled="!hasChanges || !isAdmin"
          >
            {{ t('common.saveChanges') }}
          </UButton>
        </div>
      </div>
    </UForm>
  </div>
</template>
