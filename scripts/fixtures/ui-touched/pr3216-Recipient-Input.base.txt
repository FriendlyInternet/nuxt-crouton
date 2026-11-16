<script setup lang="ts">
import { nanoid } from 'nanoid'

interface KvrSettingsRecipientItem {
  id: string
  label: string
  email: string
  isDefault?: boolean
}

const model = defineModel<KvrSettingsRecipientItem>()

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
          placeholder="Enter naam / rol"
        />
      </UFormField>
      <UFormField class="flex-1">
        <UInput
          v-model="model.email"
          class="w-full"
          size="xl"
          placeholder="Enter e-mailadres"
        />
      </UFormField>
      <UFormField>
        <USwitch v-model="model.isDefault" />
        <span class="text-sm ml-2">Standaard</span>
      </UFormField>
  </div>
</template>
