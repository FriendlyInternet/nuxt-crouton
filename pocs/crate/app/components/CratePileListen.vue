<script setup lang="ts">
import type { CratePile, CrateTrack } from '~/composables/useCrate'

// Hear what a pile sounds like without leaving where you are (#2221): a sheet with the pile's
// tracks, ~15 s samples from ~30% in, back to back. Closing it stops the sound; the deck track
// never changes.
const props = defineProps<{ audioUrl: (t: CrateTrack) => string, pathLabel: (p: CratePile) => string }>()
const emit = defineEmits<{ started: [] }>()

const SAMPLE_SECONDS = 15
const open = ref(false)
const pile = ref<CratePile | null>(null)
const queue = ref<CrateTrack[]>([])
const index = ref(-1)
const audio = ref<HTMLAudioElement>()
let sampleEnd = 0

/** Show the sheet (no sound yet — a hold fires from a timer, which iOS won't let play). */
function show(p: CratePile, tracks: CrateTrack[]) {
  pile.value = p
  queue.value = [...tracks].sort(() => Math.random() - 0.5)
  index.value = -1
  open.value = true
}
/** Must run inside a tap / touch release. */
function playAt(i: number) {
  const track = queue.value[i]
  if (!audio.value || !track) return
  emit('started')
  index.value = i
  sampleEnd = 0
  audio.value.src = props.audioUrl(track)
  audio.value.play().catch(() => {})
}
const start = () => playAt(0)

function onLoaded() {
  if (!audio.value) return
  audio.value.currentTime = (audio.value.duration || 0) * 0.3
  sampleEnd = audio.value.currentTime + SAMPLE_SECONDS
}
function onTime() {
  if (sampleEnd && (audio.value?.currentTime ?? 0) >= sampleEnd) playAt(index.value + 1)
}
watch(open, (isOpen) => { if (!isOpen) audio.value?.pause() })

defineExpose({ show, start })
</script>

<template>
  <UDrawer v-model:open="open" :title="pile ? pathLabel(pile) : ''" :description="`${queue.length} tracks with audio · ~15 s each`">
    <template #body>
      <ul class="max-h-[55dvh] divide-y divide-default/60 overflow-y-auto">
        <li v-for="(t, i) in queue" :key="t.id">
          <UButton
            block
            variant="ghost"
            :color="i === index ? 'primary' : 'neutral'"
            :icon="i === index ? 'i-lucide-audio-lines' : 'i-lucide-play'"
            class="min-w-0 justify-start rounded-none text-left"
            @click="playAt(i)"
          >
            <span class="min-w-0 truncate">{{ t.name }} <span class="text-muted">· {{ t.artist }}</span></span>
          </UButton>
        </li>
      </ul>
    </template>
  </UDrawer>
  <!-- Outside the drawer: its body only mounts once open, but a 🎧 tap must play right away. -->
  <audio ref="audio" preload="metadata" @loadedmetadata="onLoaded" @timeupdate="onTime" @ended="playAt(index + 1)" @error="playAt(index + 1)" />
</template>
