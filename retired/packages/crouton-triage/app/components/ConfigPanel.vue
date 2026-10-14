<script setup lang="ts">
interface Props {
  /** Display mode: 'slideover' or 'modal' */
  mode?: 'slideover' | 'modal'
  /** Panel title */
  title?: string
}

withDefaults(defineProps<Props>(), {
  mode: 'slideover',
  title: undefined,
})

const isOpen = defineModel<boolean>({ default: false })
</script>

<template>
  <USlideover v-if="mode === 'slideover'" v-model:open="isOpen">
    <template #content="{ close }">
      <div class="p-6 h-full overflow-y-auto">
        <div class="flex items-center justify-between mb-6">
          <h3 v-if="title" class="text-lg font-semibold">{{ title }}</h3>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="close"
          />
        </div>
        <slot :close="close" />
      </div>
    </template>
  </USlideover>

  <UModal v-else v-model:open="isOpen">
    <template #content="{ close }">
      <div class="p-6 max-h-[85vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-6">
          <h3 v-if="title" class="text-lg font-semibold">{{ title }}</h3>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="close"
          />
        </div>
        <slot :close="close" />
      </div>
    </template>
  </UModal>
</template>
