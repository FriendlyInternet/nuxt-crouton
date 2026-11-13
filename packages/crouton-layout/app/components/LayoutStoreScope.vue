<script setup lang="ts">
/**
 * CroutonLayoutStoreScope (#3650) — owns every layout store copy the layouts
 * rendered inside it read. Pass what `collectLayoutStores(tree)` returns; every
 * copy is created once, here, in this component's setup.
 *
 * Re-mount it when the list changes (the layout was edited) — state resets only
 * then: `:key="stores.map(s => s.source).join('|')"` (the list is sorted).
 */
import type { LayoutStoreEntry } from '@fyit/crouton-core/app/types/layout'
import { provideLayoutStoreScope } from '../composables/useLayoutStoreScope'

const props = defineProps<{ stores: LayoutStoreEntry[] }>()

// Read once on purpose: a changed list re-mounts the scope via its `:key`.
provideLayoutStoreScope(props.stores)
</script>

<template>
  <slot />
</template>
