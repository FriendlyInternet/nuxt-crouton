<template>
  <div class="space-y-3" role="status" aria-live="polite" aria-label="Loading content">
    <div
      v-for="i in count"
      :key="i"
      class="border rounded-lg p-3 sm:p-4 animate-pulse"
    >
      <div class="flex items-start justify-between gap-3 sm:gap-4">
        <div class="flex-1 space-y-3">
          <!-- Title -->
          <div class="h-4 bg-muted rounded w-1/3"></div>
          <!-- Description -->
          <div class="h-3 bg-muted rounded w-1/2"></div>
          <!-- Metadata -->
          <div class="flex gap-3">
            <div class="h-3 bg-muted rounded w-20"></div>
            <div class="h-3 bg-muted rounded w-24"></div>
          </div>
        </div>
        <!-- Badge/Icon -->
        <div class="h-6 w-20 bg-muted rounded flex-shrink-0"></div>
      </div>
    </div>
    <span class="sr-only">Loading...</span>
  </div>
</template>

<script setup lang="ts">
interface Props {
  count?: number
}

withDefaults(defineProps<Props>(), {
  count: 5
})
</script>
