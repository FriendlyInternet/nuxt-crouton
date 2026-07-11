<!--
  SalesLocationForm
  Package-provided form for the sales locations collection.
  Replaces the CLI-generated _Form.vue (wired via componentName in
  useSalesLocations config). Event is implied by the event workspace.
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
  </SalesFormShell>
</template>

<script setup lang="ts">
// useSalesLocations is auto-imported from the generated collection layer at runtime.
declare function useSalesLocations(): {
  defaultValue: Record<string, any>
  schema: any
  collection: string
}

interface LocationFormProps {
  action: 'create' | 'update' | 'delete'
  items?: Array<{ id: string }>
  activeItem?: Record<string, any> | null
}

const props = defineProps<LocationFormProps>()
const { t } = useT()
const { defaultValue, schema, collection } = useSalesLocations()

// Shared scaffold: state (activeItem-merged), submit switch, in-form delete.
const { state, hideEvent, loading, handleSubmit, deleting, handleDelete }
  = useSalesCollectionForm(props, { collection, defaultValue })
</script>