<script setup lang="ts">
/**
 * The settings pane's fixed save footer (#1846).
 *
 * SettingsTab hands its `{ save, dirty, saving }` API up to whichever host
 * mounts it, and all three hosts (desktop pane, narrow slideover, PaneHost
 * modal) render this identical bar below the scroll area. Extracted so the
 * disabled/dirty styling can't drift between them. Horizontal padding stays
 * with the host (Shell uses px-3, PaneHost px-4) via class passthrough.
 */
defineProps<{ dirty: boolean, saving: boolean }>()
const emit = defineEmits<{ save: [] }>()

const { t } = useT()
</script>

<template>
  <div class="flex-none flex items-center justify-end gap-3 border-t border-default bg-default py-3">
    <span v-if="dirty" class="text-sm text-muted">{{ t('sales.workspace.unsavedChanges') }}</span>
    <UButton
      :loading="saving"
      :disabled="!dirty"
      :color="dirty ? 'primary' : 'neutral'"
      :variant="dirty ? 'solid' : 'soft'"
      @click="emit('save')"
    >
      {{ t('sales.common.save') }}
    </UButton>
  </div>
</template>
