<template>
  <UButton
    :loading="loading !== 'notLoading'"
    :disabled="loading !== 'notLoading'"
    size="lg"
    block
    :color="action === 'delete' ? 'error' : 'primary'"
    :variant="hasValidationErrors ? 'outline' : 'solid'"
    :class="{ 'opacity-50 cursor-not-allowed': hasValidationErrors && loading === 'notLoading' }"
    type="submit"
  >
    <div class="flex items-center gap-2">
      <UIcon
        v-if="hasValidationErrors && loading === 'notLoading'"
        name="i-lucide-triangle-alert"
        class="size-5"
      />
      <span>{{ label }}</span>
    </div>
  </UButton>
</template>

<script setup lang="ts">
// Same wording as the form title ("Modifier Lieu"), from the locale files — not "Update  location"
const { t } = useT()
const { singular } = useCollectionLabel()

const props = defineProps<{
  action: string
  collection: string
  items?: any[]
  loading?: string
  hasValidationErrors?: boolean
}>()

const label = computed(() => t(`form.titles.${props.action}`, { collection: singular(props.collection) }))
</script>
