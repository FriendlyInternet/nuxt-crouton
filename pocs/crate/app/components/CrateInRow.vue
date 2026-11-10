<script setup lang="ts">
import type { CratePile } from '~/composables/useCrate'

defineProps<{
  inPiles: CratePile[]
  otherTags: string[]
  pathLabel: (p: CratePile) => string
  /** The level we're inside, when the track is in it: "↑ Not <pile>" takes it out (#2210). */
  notIn: CratePile | null
}>()
const emit = defineEmits<{ remove: [pile: CratePile], not: [pile: CratePile] }>()
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
    <span class="text-xs text-muted">In:</span>
    <span v-if="!inPiles.length && !otherTags.length" class="text-xs text-dimmed">nothing yet</span>
    <UBadge v-for="p in inPiles" :key="p.id" color="primary" variant="subtle" class="max-w-full">
      <span class="truncate">{{ pathLabel(p) }}</span>
      <UButton icon="i-lucide-x" size="xs" variant="link" color="primary" class="-my-1 -me-1 p-0" :aria-label="`Remove from ${p.name}`" @click="emit('remove', p)" />
    </UBadge>
    <UBadge v-for="tag in otherTags" :key="tag" color="neutral" variant="soft" class="max-w-full">
      <span class="truncate">{{ tag }}</span>
    </UBadge>
    <UButton v-if="notIn" icon="i-lucide-arrow-up" size="xs" color="neutral" variant="soft" class="ms-auto shrink-0" :label="`Not ${notIn.name}`" @click="emit('not', notIn)" />
  </div>
</template>
