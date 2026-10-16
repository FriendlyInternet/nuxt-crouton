<script setup lang="ts">
/**
 * Block Translate Trigger
 *
 * Thin trigger button used by `<CroutonI18nInput>` for block-editor field
 * translations. Unlike `<AITranslateButton>` (which handles its own API
 * call), this component is controlled by the parent — it just emits
 * `click` and reflects loading/disabled state. The parent runs the
 * actual block translation flow (with its own confirmation modal).
 */

defineProps<{
  loading?: boolean
  disabled?: boolean
  tooltip?: string
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
}>()

defineEmits<{
  click: []
}>()

const { t } = useT()
</script>

<template>
  <UTooltip :text="tooltip || t('i18n.translateWithAi')">
    <UButton
      icon="i-lucide-sparkles"
      :size="(size || '2xs') as any"
      variant="ghost"
      color="neutral"
      class="opacity-40 hover:opacity-100 transition-opacity"
      :loading="loading"
      :disabled="disabled"
      @click="$emit('click')"
    />
  </UTooltip>
</template>
