<script setup lang="ts">
/**
 * The event + title header fields every sales collection form opens with —
 * extracted from the per-form copies (#1391 fallow audit). The event selector
 * hides when the workspace preset an event (hideEvent).
 */
defineProps<{ hideEvent?: boolean }>()

const eventId = defineModel<string | null>('eventId')
const title = defineModel<string>('title')

const { t } = useT()
</script>

<template>
  <UFormField v-if="!hideEvent" :label="t('sales.form.event')" name="eventId" class="not-last:pb-4">
    <CroutonFormReferenceSelect
      v-model="eventId"
      collection="salesEvents"
      :label="t('sales.form.event')"
    />
  </UFormField>
  <UFormField :label="t('sales.form.title')" name="title" class="not-last:pb-4">
    <UInput v-model="title" class="w-full" size="xl" />
  </UFormField>
</template>
