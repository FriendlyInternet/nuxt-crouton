<script setup lang="ts">
import type { CratePile } from '~/composables/useCrate'

defineProps<{ trail: CratePile[], trayLabel: string, trayCount: number, uploading?: { done: number, total: number } | null, editing: boolean }>()
const emit = defineEmits<{ open: [pile: CratePile | null], up: [], undo: [], list: [], listen: [], upload: [], edit: [] }>()
</script>

<template>
  <header class="flex min-w-0 items-center gap-1 border-b border-default px-2 pt-[max(0.375rem,env(safe-area-inset-top))] pb-1.5">
    <UButton v-if="trail.length" icon="i-lucide-arrow-left" size="sm" variant="ghost" color="neutral" aria-label="Up a level" @click="emit('up')" />
    <nav class="flex min-w-0 flex-1 items-center gap-1 text-sm">
      <UButton variant="link" color="neutral" class="px-1 font-semibold" label="Crate" @click="emit('open', null)" />
      <template v-for="p in trail" :key="p.id">
        <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
        <UButton variant="link" color="neutral" class="min-w-0 px-0" @click="emit('open', p)">
          <span class="truncate">{{ p.name }}</span>
        </UButton>
      </template>
    </nav>
    <UButton v-if="trail.length" icon="i-lucide-headphones" size="sm" variant="ghost" color="primary" :aria-label="`Listen to ${trail.at(-1)!.name}`" class="shrink-0" @click="emit('listen')" />
    <UButton
      icon="i-lucide-upload"
      size="sm"
      variant="ghost"
      color="neutral"
      :loading="!!uploading"
      :label="uploading ? `${uploading.done}/${uploading.total}` : undefined"
      aria-label="Add new tracks"
      class="shrink-0 tabular-nums"
      @click="emit('upload')"
    />
    <UButton
      :icon="editing ? 'i-lucide-check' : 'i-lucide-pencil'"
      size="sm"
      :variant="editing ? 'solid' : 'ghost'"
      :color="editing ? 'primary' : 'neutral'"
      :aria-label="editing ? 'Done editing piles' : 'Edit piles'"
      :aria-pressed="editing"
      class="shrink-0 transition-colors"
      @click="emit('edit')"
    />
    <UButton icon="i-lucide-undo-2" size="sm" variant="ghost" color="neutral" aria-label="Undo last change" class="shrink-0" @click="emit('undo')" />
    <UColorModeButton size="sm" class="shrink-0" />
    <UButton :label="String(trayCount)" icon="i-lucide-inbox" size="sm" variant="soft" color="neutral" class="shrink-0 tabular-nums" :aria-label="`${trayLabel}: ${trayCount} tracks`" @click="emit('list')" />
  </header>
</template>
