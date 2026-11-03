<!--
  Fixture card for mainItems — resolved by name (`MainItemsCard`) through the
  collection-forms map when <CroutonCollection> renders a list/grid layout.
  The "card renders" e2e check asserts the marker below, which only this card prints.
-->
<template>
  <div class="flex items-center gap-2">
    <span data-testid="main-items-card">CARD-RENDERS · {{ item.name }}</span>
  </div>
</template>

<script setup lang="ts">
// fallow-ignore-file unused-component-props
// Card contract props: declared so <CroutonCollection>'s extras don't fall through onto the root as attrs.
defineProps<{
  item: any
  layout?: string
  collection?: string
  stateless?: boolean
}>()
</script>
