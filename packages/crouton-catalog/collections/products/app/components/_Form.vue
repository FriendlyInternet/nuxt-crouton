<!--
  CatalogProductsForm
  Form for the catalog products collection: title + description through one
  translation input, and an on/off switch.
-->

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
    class="flex flex-col gap-4 p-1"
    @submit="handleSubmit"
  >
    <CroutonI18nInput
      v-model="(state.translations as any)"
      :fields="['title', 'description']"
      :default-values="{
        title: state.title || '',
        description: state.description || ''
      }"
      field-type="products"
      :label="$t('products.form.translations')"
      @update:english="(data: { field: string, value: string }) => applyDefaultLocaleProductFields(state, data)"
    />

    <UFormField name="active">
      <USwitch v-model="(state.active as any)" :label="$t('products.form.active')" />
    </UFormField>

    <CroutonFormActionButton
      :action="action"
      :collection="collection"
      :items="items"
      :loading="loading"
    />
  </UForm>
</template>

<script setup lang="ts">
import useCatalogProducts from '../composables/useCatalogProducts'
import { applyDefaultLocaleProductFields } from '../utils/applyDefaultLocaleProductFields'

interface ProductFormProps {
  action: 'create' | 'update' | 'delete'
  items?: Array<{ id: string }>
  activeItem?: Record<string, any> | null
}

const props = defineProps<ProductFormProps>()
const { defaultValue, schema, collection } = useCatalogProducts(useI18n())

const { create, update, deleteItems } = useCollectionMutation(collection)
const { close, loading } = useCrouton()

// Initialize form state
const initialValues = props.action === 'update' && props.activeItem?.id
  ? { ...defaultValue, ...props.activeItem }
  : { ...defaultValue }

const state = ref<Record<string, any>>(initialValues)

const handleSubmit = async () => {
  try {
    if (props.action === 'create') {
      await create(state.value)
    } else if (props.action === 'update' && state.value.id) {
      await update(state.value.id, state.value)
    } else if (props.action === 'delete') {
      await deleteItems(props.items as any)
    }
    close()
  } catch (error) {
    console.error('Form submission failed:', error)
  }
}
</script>
