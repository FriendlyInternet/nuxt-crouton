<script setup lang="ts">
import type { CrateTrack } from '~/composables/useCrate'

defineProps<{ track: CrateTrack, meta: string, playing: boolean, hasAudio: boolean, canNext: boolean, checked: boolean }>()
const emit = defineEmits<{ toggle: [], skip: [seconds: number], next: [], done: [], edit: [], press: [e: PointerEvent] }>()
</script>

<template>
  <!-- Title gets its own line so it never truncates behind the buttons; the transport sits under it. -->
  <div class="min-w-0 space-y-2">
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
          <span class="line-clamp-2">{{ track.name }} <span class="font-normal text-muted">· {{ track.artist || 'Unknown artist' }}</span></span>
          <UButton v-if="track.uploaded" icon="i-lucide-pencil" size="xs" variant="ghost" color="neutral" class="shrink-0" aria-label="Rename or delete this upload" @click="emit('edit')" />
        </p>
        <p class="mt-0.5 truncate text-xs tabular-nums text-dimmed">{{ meta }}</p>
      </div>
      <!-- Drag handle (#2210): only this grip drags the track onto a pile, so the rest of the card
           keeps swiping (left/right = track, up = Done, down = tuck away). It is kept out of those
           swipes (data-no-swipe for the carousel, touch events stopped for up/down), and
           touch-none stops iOS scrolling instead. -->
      <UButton
        icon="i-lucide-grip-vertical"
        size="lg"
        color="neutral"
        variant="soft"
        class="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
        title="Drag onto a pile"
        aria-label="Drag onto a pile"
        data-no-swipe
        @pointerdown="(e: PointerEvent) => emit('press', e)"
        @touchstart.stop
        @touchmove.stop
        @touchend.stop
      />
    </div>
    <CrateTransport class="justify-end" :has-audio="hasAudio" :can-next="canNext" :checked="checked" @skip="(s) => emit('skip', s)" @next="emit('next')" @done="emit('done')" />
  </div>
</template>
