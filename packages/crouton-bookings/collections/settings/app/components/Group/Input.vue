<script setup lang="ts">
import { nanoid } from 'nanoid'

interface BookingsSettingsGroupItem {
  id: string
  label?: string
  value?: string
}

const model = defineModel<BookingsSettingsGroupItem>()

// Ensure stable ID on first creation
if (model.value && !model.value.id) {
  model.value = { ...model.value, id: nanoid() }
}
</script>

<template>
  <div class="flex items-center gap-2 w-full">
      <UFormField class="flex-1">
        <UInput
          v-model="model!.label"
          class="w-full"
          size="xl"
          placeholder="Enter label"
        />
      </UFormField>
  </div>
</template>
