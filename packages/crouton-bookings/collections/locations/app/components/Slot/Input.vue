<script setup lang="ts">
import { nanoid } from 'nanoid'

interface BookingsLocationsSlotItem {
  id: string
  label: string
  capacity?: number
}

const model = defineModel<BookingsLocationsSlotItem>()

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
          placeholder="Enter slot name"
        />
      </UFormField>
      <UFormField class="w-24">
        <UInputNumber
          v-model="model!.capacity"
          size="xl" placeholder="1"
        />
      </UFormField>
  </div>
</template>
