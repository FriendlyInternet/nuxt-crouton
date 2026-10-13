<script setup lang="ts">
import type { CratePile, CrateTrack } from '~/composables/useCrate'

// Hear what a pile sounds like (#2221): ~15 s samples of its tracks, back to back, on a
// separate player so the deck track stays put.
const props = defineProps<{ audioUrl: (t: CrateTrack) => string }>()
const emit = defineEmits<{ started: [] }>()

const SAMPLE_SECONDS = 15
const audio = ref<HTMLAudioElement>()
const pile = ref<CratePile | null>(null)
const queue = ref<CrateTrack[]>([])
const index = ref(0)
const current = computed(() => queue.value[index.value] ?? null)
let sampleEnd = 0

function playAt(i: number) {
  const track = queue.value[i]
  if (!audio.value || !track) return stop()
  index.value = i
  sampleEnd = 0
  audio.value.src = props.audioUrl(track)
  audio.value.play().catch(() => {})
}

/** Must be called from the tap itself (iOS starts audio only inside a user gesture). */
function start(p: CratePile, tracks: CrateTrack[]) {
  pile.value = p
  queue.value = [...tracks].sort(() => Math.random() - 0.5)
  emit('started')
  playAt(0)
}
function stop() {
  audio.value?.pause()
  pile.value = null
  queue.value = []
}

// Start each sample ~30% in (intros rarely tell the genre), move on after SAMPLE_SECONDS.
function onLoaded() {
  if (!audio.value) return
  audio.value.currentTime = (audio.value.duration || 0) * 0.3
  sampleEnd = audio.value.currentTime + SAMPLE_SECONDS
}
function onTime() {
  if (sampleEnd && (audio.value?.currentTime ?? 0) >= sampleEnd) playAt(index.value + 1)
}

defineExpose({ start, stop })
</script>

<template>
  <div v-show="pile" class="flex min-w-0 items-center gap-2 border-t border-default bg-primary/10 px-3 py-1.5">
    <UIcon name="i-lucide-headphones" class="size-4 shrink-0 text-primary" />
    <p class="min-w-0 flex-1 truncate text-xs leading-tight">
      <span class="font-semibold text-primary">{{ pile?.name }}</span>
      <span class="tabular-nums text-muted"> · {{ index + 1 }}/{{ queue.length }}</span>
      <span v-if="current"> · {{ current.artist }} – {{ current.name }}</span>
    </p>
    <UFieldGroup size="xs">
      <UButton icon="i-lucide-skip-forward" color="neutral" variant="soft" aria-label="Next sample" @click="playAt(index + 1)" />
      <UButton icon="i-lucide-x" color="neutral" variant="soft" aria-label="Stop listening" @click="stop" />
    </UFieldGroup>
    <audio ref="audio" preload="metadata" @loadedmetadata="onLoaded" @timeupdate="onTime" @ended="playAt(index + 1)" @error="playAt(index + 1)" />
  </div>
</template>
