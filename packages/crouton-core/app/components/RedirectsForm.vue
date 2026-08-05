<template>
  <CroutonFormActionButton
    v-if="action === 'delete'"
    :action="action"
    :collection="collection"
    :items="items"
    :loading="loading"
    @click="handleSubmit"
  />

  <UForm
    v-else
    :schema="schema"
    :state="state"
    @submit="handleSubmit"
    @error="handleValidationError"
  >
    <CroutonFormLayout v-model="activeSection">
      <template #main>
        <div class="flex flex-col gap-4 p-1">
          <UFormField :label="$t('redirects.fromPath')" name="fromPath" class="not-last:pb-4">
            <UInput v-model="state.fromPath" class="w-full" size="xl" placeholder="/old-page" />
          </UFormField>
          <UFormField :label="$t('redirects.toPath')" name="toPath" class="not-last:pb-4">
            <UInput v-model="state.toPath" class="w-full" size="xl" placeholder="/new-page" />
          </UFormField>
        </div>
      </template>

      <template #sidebar>
        <div class="flex flex-col gap-4 p-1">
          <UFormField :label="$t('redirects.statusCode')" name="statusCode" class="not-last:pb-4">
            <USelectMenu
              v-model="state.statusCode"
              :items="statusCodeOptions"
              value-key="value"
              class="w-full"
              size="xl"
            />
          </UFormField>
          <UFormField :label="$t('redirects.active')" name="isActive" class="not-last:pb-4">
            <USwitch v-model="state.isActive" />
          </UFormField>
        </div>
      </template>

      <template #footer>
        <CroutonValidationErrorSummary
          v-if="validationErrors.length > 0"
          :tab-errors="tabErrorCounts"
          :navigation-items="[]"
          @switch-tab="() => {}"
        />

        <CroutonFormActionButton
          :action="action"
          :collection="collection"
          :items="items"
          :loading="loading"
          :has-validation-errors="validationErrors.length > 0"
        />
      </template>
    </CroutonFormLayout>
  </UForm>
</template>

<script setup lang="ts">
import type { CroutonRedirectFormProps, CroutonRedirectFormData } from '../../types/redirects'
import useCroutonRedirects from '../composables/useCroutonRedirects'

const props = defineProps<CroutonRedirectFormProps>()
const { t } = useI18n()
const { defaultValue, schema, collection } = useCroutonRedirects()

const activeSection = ref('main')

const statusCodeOptions = computed(() => [
  { label: `301 — ${t('redirects.permanent')}`, value: '301' },
  { label: `302 — ${t('redirects.temporary')}`, value: '302' }
])

const validationErrors = ref<Array<{ name: string; message: string }>>([])

const handleValidationError = (event: any) => {
  if (event?.errors) {
    validationErrors.value = event.errors
  }
}

const tabErrorCounts = computed(() => {
  const counts: Record<string, number> = {}
  validationErrors.value.forEach(error => {
    counts['main'] = (counts['main'] || 0) + 1
  })
  return counts
})

const { create, update, deleteItems } = useCollectionMutation(collection)
const { close, loading } = useCrouton()

// initFormState coerces a nullable column's loaded null back to the form
// default so it never reaches the narrow client schema and blocks submit (#1498).
const initialValues = props.action === 'update' && props.activeItem?.id
  ? initFormState(defaultValue, props.activeItem)
  : { ...defaultValue }

const state = ref<CroutonRedirectFormData & { id?: string | null }>(initialValues as CroutonRedirectFormData & { id?: string | null })

const handleSubmit = async () => {
  try {
    if (props.action === 'create') {
      await create(state.value)
    } else if (props.action === 'update' && state.value.id) {
      await update(state.value.id, state.value)
    } else if (props.action === 'delete') {
      await deleteItems(props.items)
    }

    validationErrors.value = []
    close()
  } catch (error) {
    console.error('Form submission failed:', error)
  }
}
</script>
