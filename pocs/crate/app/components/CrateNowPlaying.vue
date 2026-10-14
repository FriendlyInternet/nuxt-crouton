<script setup lang="ts">
import type { CrateTrack } from '~/composables/useCrate'

defineProps<{ track: CrateTrack, meta: string, playing: boolean, hasAudio: boolean, canNext: boolean, checked: boolean }>()
const emit = defineEmits<{ toggle: [], skip: [seconds: number], next: [], done: [], edit: [] }>()
</script>

<template>
  <div class="flex min-w-0 items-center gap-2.5">
    <UButton
      :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
      size="lg"
      class="shrink-0 rounded-full"
      :disabled="!hasAudio"
      :aria-label="playing ? 'Pause' : 'Play'"
      @click="emit('toggle')"
    />
    <div class="min-w-0 flex-1 leading-tight">
      <p class="flex min-w-0 items-center gap-1 font-semibold">
        <span class="truncate">{{ track.name }} <span class="font-normal text-muted">· {{ track.artist || 'Unknown artist' }}</span></span>
        <UButton v-if="track.uploaded" icon="i-lucide-pencil" size="xs" variant="ghost" color="neutral" class="shrink-0" aria-label="Rename or delete this upload" @click="emit('edit')" />
      </p>
      <p class="mt-0.5 truncate text-xs tabular-nums text-dimmed">{{ meta }}</p>
    </div>
    <CrateTransport :has-audio="hasAudio" :can-next="canNext" :checked="checked" @skip="(s) => emit('skip', s)" @next="emit('next')" @done="emit('done')" />
  </div>
</template>
