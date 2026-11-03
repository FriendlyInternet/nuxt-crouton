<!--
  What the Content tab shows for an app page type that has no block content and no bound
  collection: its config fields, or a note that the type renders its own component (#2324).
-->
<script setup lang="ts">
const props = defineProps<{
  pageType?: { name?: string, configSchema?: Array<{ name: string }> } | null
}>()
const { t } = useT()
const typeLabel = computed(() => (props.pageType?.name ? t(props.pageType.name, props.pageType.name) : ''))
</script>

<template>
  <div class="mx-auto w-full max-w-3xl px-4 py-4">
    <template v-if="pageType?.configSchema?.length">
      <USeparator :label="t('pages.editor.pageSettings')" class="my-2" />
      <div class="space-y-4">
        <div v-for="field in pageType.configSchema" :key="field.name" class="text-sm text-muted">
          {{ t('pages.editor.configField', { name: field.name }) }}
        </div>
      </div>
    </template>
    <div v-else class="p-4 bg-muted/30 rounded-lg text-center text-sm text-muted">
      <UIcon name="i-lucide-info" class="size-5 mb-2" />
      <p>{{ t('pages.editor.noConfig') }}</p>
      <p>{{ t('pages.editor.displaysComponent', { name: typeLabel }) }}</p>
    </div>
  </div>
</template>
