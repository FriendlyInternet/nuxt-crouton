<template>
  <!--
    Hidden on mobile: CollectionViewer surfaces compact import/create icon
    buttons in its single header row below `sm`, so this navbar would be a
    redundant second bar. Restored at `sm+`. (#691)
  -->
  <div class="hidden sm:block">
    <UDashboardNavbar :title="collection || 'Data'">
      <template #left>
        <h2>
          {{ title }}
        </h2>
      </template>
      <template #right>
        <slot name="extraButtons" />

        <CroutonImportButton
          v-if="importButton && collection"
          :collection="collection"
          @import-complete="$emit('import-complete')"
        />

        <CroutonExportButton
          v-if="exportButton && rows?.length"
          :collection="collection"
          :rows="rows"
        />

        <UButton
          v-if="createButton"
          color="primary"
          size="md"
          :variant="getVariant('solid')"
          @click="handleCreate"
        >
          <span>{{ t('common.create') }} <span class="hidden md:inline">{{ useFormatCollections().collectionWithCapitalSingular(collection) }}</span></span>
        </UButton>
      </template>
    </UDashboardNavbar>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { CROUTON_ITEM_ACTION_KEY } from '../types/table'

const { t } = useT()
const itemAction = inject(CROUTON_ITEM_ACTION_KEY, undefined)
const { open } = useCrouton()
const { getConfig } = useCollections()

const props = withDefaults(defineProps<{
  title?: string
  collection?: string
  createButton?: boolean
  exportButton?: boolean
  importButton?: boolean
  rows?: any[]
}>(), {
  title: '',
  collection: '',
  createButton: false,
  exportButton: true,
  importButton: true,
  rows: () => []
})

// Theme variant support
const getVariant = (base: string) => {
  try {
    // @ts-ignore useThemeSwitcher only exists when the crouton-themes layer is extended
    const switcher = useThemeSwitcher?.()
    return switcher?.getVariant?.(base) ?? base
  } catch {
    return base
  }
}

const handleCreate = () => {
  if (itemAction) {
    itemAction('create')
  } else {
    const container = getConfig(props.collection)?.container ?? 'slideover'
    open('create', props.collection, [], container)
  }
}
</script>
