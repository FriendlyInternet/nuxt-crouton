<!--
  SalesCategoryForm
  Package-provided form for the sales categories collection.
  Replaces the CLI-generated _Form.vue (wired via componentName in
  useSalesCategories config). Event is implied by the event workspace.
-->

<template>
  <SalesFormShell
    :action="action"
    :collection="collection"
    :items="items"
    :loading="loading"
    :schema="schema"
    :state="state"
    :deleting="deleting"
    @submit="handleSubmit"
    @delete="handleDelete"
  >
          <SalesFormEventTitleFields v-model:event-id="state.eventId" v-model:title="state.title" :hide-event="hideEvent" />
          <UFormField :label="t('sales.form.displayOrder')" name="displayOrder" class="not-last:pb-4">
            <UInputNumber v-model="state.displayOrder" class="w-full" :min="0" />
          </UFormField>
  </SalesFormShell>
</template>

<script setup lang="ts">
// useSalesCategories is auto-imported from the generated collection layer at runtime.
declare function useSalesCategories(): {
  defaultValue: Record<string, any>
  schema: any
  collection: string
}

interface CategoryFormProps {
  action: 'create' | 'update' | 'delete'
  items?: Array<{ id: string }>
  activeItem?: Record<string, any> | null
}

const props = defineProps<CategoryFormProps>()
const { t } = useT()
const { defaultValue, schema, collection } = useSalesCategories()

// Shared scaffold: state (activeItem-merged), submit switch, in-form delete.
const { state, hideEvent, loading, handleSubmit, deleting, handleDelete }
  = useSalesCollectionForm(props, { collection, defaultValue })
</script>