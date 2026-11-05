<script setup lang="ts">
import CroutonAssetsCardComponent from './Card.vue'

const props = defineProps<{
  collection?: string
}>()

const { getConfig } = useCollections()
// Resolve collection registry key: prefer configs that have an apiPath (i.e. a generated collection)
// The package registers a partial 'assets' config (no apiPath),
// so we must check for the actual generated collection key first.
const collectionName = props.collection
  || (getConfig('croutonAssets')?.apiPath ? 'croutonAssets' : undefined)
  || (getConfig('assetsAssets')?.apiPath ? 'assetsAssets' : undefined)
  || (getConfig('assets')?.apiPath ? 'assets' : undefined)
  || 'croutonAssets'

const { items } = await useCollectionQuery(collectionName)

const assetCardComponent = CroutonAssetsCardComponent
</script>

<template>
  <CroutonCollection
    :collection="collectionName"
    layout="grid"
    grid-size="compact"
    :rows="items || []"
    :card-component="assetCardComponent"
    create
    class="h-full"
  />
</template>
