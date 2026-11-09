<script setup lang="ts">
/**
 * Account Settings overlay
 *
 * Created by useAccountSettingsModal() through useOverlay() — never mounted
 * in a template. UDrawer (bottom sheet) below lg, UModal at lg+.
 */
defineProps<{
  open?: boolean
  defaultTab?: string
  openKey?: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'close': [value?: unknown]
}>()

const isDesktop = useMediaQuery('(min-width: 1024px)')

function onUpdate(value: boolean) {
  emit('update:open', value)
  if (!value) emit('close')
}
</script>

<template>
  <UModal
    v-if="isDesktop"
    :open="open"
    :ui="{ content: 'sm:max-w-2xl' }"
    @update:open="onUpdate"
  >
    <template #content>
      <div class="p-6 max-h-[80vh] overflow-y-auto">
        <AccountSettings :key="openKey" :default-tab="defaultTab" />
      </div>
    </template>
  </UModal>
  <UDrawer
    v-else
    :open="open"
    direction="bottom"
    @update:open="onUpdate"
  >
    <template #content>
      <div class="p-4 max-h-[85vh] overflow-y-auto">
        <AccountSettings :key="openKey" :default-tab="defaultTab" />
      </div>
    </template>
  </UDrawer>
</template>
