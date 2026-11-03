<script setup lang="ts">
import { nanoid } from 'nanoid'

interface SalesProductsOptionItem {
  id: string
  label?: string
  priceModifier?: number
}

const model = defineModel<SalesProductsOptionItem>({ required: true })

// Ensure stable ID on first creation
if (model.value && !model.value.id) {
  model.value = { ...model.value, id: nanoid() }
}
</script>

<template>
  <div class="flex items-center gap-2 w-full">
      <UFormField class="flex-1">
        <UInput
          v-model="model.label"
          class="w-full"
          size="xl"
          placeholder="Enter label"
        />
      </UFormField>
      <UFormField>
        <UInputNumber
          v-model="model.priceModifier"
          class="w-32"
          size="xl"
          :default-value="0"
          :step="0.10"
          placeholder="Price +/-"
        />
      </UFormField>
  </div>
</template>
