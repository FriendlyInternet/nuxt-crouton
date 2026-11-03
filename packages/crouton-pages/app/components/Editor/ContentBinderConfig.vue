<!--
  Collection-binder settings for a `pages:collection-binder` page (#2324): which collection
  the page lists, how it sorts, and what it groups by. Stored in the page's `config`.
-->
<script setup lang="ts">
defineProps<{ collectionOptions: Array<{ value: string, label: string }> }>()
const config = defineModel<Record<string, any> | null>('config', { default: () => ({}) })
const { t } = useT()

function configField<T>(key: string, fallback: T, store: (val: T) => unknown = v => v) {
  return computed<T>({
    get: () => ((config.value as any)?.[key] ?? fallback) as T,
    set: (val: T) => { config.value = { ...config.value, [key]: store(val) } },
  })
}
const collection = configField<string | undefined>('collection', undefined)
const sortField = configField<string>('sortField', '', v => v || null)
const sortOrder = configField<string>('sortOrder', 'asc')
const groupBy = configField<string>('groupBy', '', v => v || null)
</script>

<template>
  <div class="px-4 pt-4 pb-3 shrink-0 border-b border-default space-y-3">
    <UFormField :label="t('pages.editor.binder.bindCollection')" name="config.collection" :help="t('pages.editor.binder.bindCollectionHelp')">
      <USelect
        v-model="collection"
        :items="collectionOptions"
        value-key="value"
        :placeholder="t('pages.editor.binder.selectCollection')"
        size="sm"
        class="w-full"
      />
    </UFormField>
    <div class="grid grid-cols-2 gap-2">
      <UFormField :label="t('pages.editor.binder.sortField')" name="config.sortField" :help="t('pages.editor.binder.sortFieldHelp')">
        <UInput v-model="sortField" placeholder="order" size="sm" class="w-full" />
      </UFormField>
      <UFormField :label="t('pages.editor.binder.sortOrder')" name="config.sortOrder">
        <USelect
          v-model="sortOrder"
          :items="[{ value: 'asc', label: t('common.ascending') }, { value: 'desc', label: t('common.descending') }]"
          value-key="value"
          size="sm"
          class="w-full"
        />
      </UFormField>
    </div>
    <UFormField :label="t('pages.editor.binder.groupBy')" name="config.groupBy" :help="t('pages.editor.binder.groupByHelp')">
      <UInput v-model="groupBy" :placeholder="t('pages.editor.binder.groupByPlaceholder')" size="sm" class="w-full" />
    </UFormField>
  </div>
</template>
