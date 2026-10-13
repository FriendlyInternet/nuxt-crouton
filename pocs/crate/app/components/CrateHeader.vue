<script setup lang="ts">
import type { CratePile } from '~/composables/useCrate'

defineProps<{ trail: CratePile[], trayLabel: string, trayCount: number }>()
const emit = defineEmits<{ open: [pile: CratePile | null], up: [], undo: [], list: [] }>()
</script>

<template>
  <header class="flex min-w-0 items-center gap-2 border-b border-default px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
    <UButton v-if="trail.length" icon="i-lucide-arrow-left" variant="ghost" color="neutral" aria-label="Up a level" @click="emit('up')" />
    <nav class="flex min-w-0 flex-1 items-center gap-1 text-sm">
      <UButton variant="link" color="neutral" class="px-0 font-semibold" label="Crate" @click="emit('open', null)" />
      <template v-for="p in trail" :key="p.id">
        <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
        <UButton variant="link" color="neutral" class="min-w-0 px-0" @click="emit('open', p)">
          <span class="truncate">{{ p.name }}</span>
        </UButton>
      </template>
    </nav>
    <UButton icon="i-lucide-undo-2" variant="ghost" color="neutral" aria-label="Undo last change" class="shrink-0" @click="emit('undo')" />
    <UButton :label="`${trayLabel} · ${trayCount}`" icon="i-lucide-inbox" size="sm" variant="soft" color="neutral" class="shrink-0" @click="emit('list')" />
  </header>
</template>
