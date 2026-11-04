<script setup lang="ts">
// fallow-ignore-file unused-component-props
// Stub renders nothing — @fyit/crouton-pages overrides it with the real editor with preview.
defineProps<{
  modelValue?: unknown
  yxmlFragment?: unknown
  collabProvider?: unknown
  collabUser?: unknown
  editable?: boolean
  placeholder?: string
  previewTitle?: string
  defaultTab?: 'editor' | 'preview'
  previewScale?: number
}>()

defineEmits<{
  'update:modelValue': [value: unknown]
}>()
</script>

<template>
  <!-- Stub renders nothing - real component provided by @fyit/crouton-pages -->
</template>
