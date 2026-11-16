<!--
  CatalogProductsList
  List for the catalog products collection: title (in the current locale) and
  whether the product is active.
-->

<template>
  <CroutonCollection
    :layout="layout"
    collection="catalogProducts"
    :columns="columns"
    :rows="products || []"
    :loading="pending"
  >
    <template #header>
      <CroutonTableHeader
        :title="$t('catalog.collections.products.title')"
        :collection="'catalogProducts'"
        createButton
      />
    </template>
    <template #title-cell="{ row }">
      {{ t(row.original, 'title') }}
    </template>
    <template #active-cell="{ row }">
      <CroutonBoolean :value="row.original.active" />
    </template>
  </CroutonCollection>
</template>

<script setup lang="ts">
import useCatalogProducts from '../composables/useCatalogProducts'

withDefaults(defineProps<{
  layout?: any
}>(), {
  layout: 'table'
})

const { t } = useEntityTranslations()
const { columns } = useCatalogProducts()

const { items: products, pending } = await useCollectionQuery(
  'catalogProducts'
)
</script>
