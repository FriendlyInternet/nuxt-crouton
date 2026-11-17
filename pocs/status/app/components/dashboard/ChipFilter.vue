<script setup lang="ts">
// "All" + one button per option; the selected one is solid. null = All.
defineProps<{ options: string[] }>()
const selected = defineModel<string | null>({ default: null })
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <UButton size="sm" :variant="selected === null ? 'solid' : 'outline'" label="All" @click="selected = null" />
    <UButton
      v-for="o in options"
      :key="o"
      size="sm"
      :variant="selected === o ? 'solid' : 'outline'"
      :label="o"
      @click="selected = o"
    />
  </div>
</template>
