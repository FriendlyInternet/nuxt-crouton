<script setup lang="ts">
import type { CratePile, CrateTrack } from '~/composables/useCrate'

const props = defineProps<{
  track: CrateTrack | null
  src: string | null
  inPiles: CratePile[]
  otherTags: string[]
  pathLabel: (p: CratePile) => string
  canNext: boolean
}>()
const emit = defineEmits<{ prev: [], next: [], list: [], remove: [pile: CratePile] }>()

const audio = ref<HTMLAudioElement>()
const playing = ref(false)
const position = ref(0)
const duration = ref(0)

// Start ~30% in — intros rarely tell the genre.
function onLoaded() {
  if (!audio.value) return
  duration.value = audio.value.duration || 0
  audio.value.currentTime = duration.value * 0.3
}

// Must run inside the tap handler: iOS only starts audio from a user gesture.
function play() {
  audio.value?.play().catch(() => { playing.value = false })
}
/** Switch to `url` and start it in the same tap (Next autoplays) — setting src here, not via
 *  the prop, keeps play() inside the user gesture. */
function playSrc(url: string) {
  if (!audio.value) return
  audio.value.src = url
  play()
}
function toggle() {
  if (!audio.value) return
  if (audio.value.paused) play()
  else audio.value.pause()
}
function skip(seconds: number) {
  if (audio.value) audio.value.currentTime = Math.max(0, Math.min(duration.value, audio.value.currentTime + seconds))
}

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const meta = computed(() => {
  const t = props.track
  if (!t) return ''
  return [t.bpm ? `${Math.round(t.bpm)} BPM` : null, t.tonality, t.year, t.genre].filter(Boolean).join(' · ')
})

function seek(value: number | undefined) {
  if (audio.value && value !== undefined) audio.value.currentTime = value
}

watch(() => props.src, () => {
  position.value = 0
  duration.value = 0
})

defineExpose({ playSrc })
</script>

<template>
  <div class="rounded-t-2xl border-t border-default bg-elevated/95 backdrop-blur px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg">
    <div v-if="track" class="min-w-0 space-y-2">
      <div class="flex items-start gap-3 min-w-0">
        <UButton
          :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
          size="xl"
          class="rounded-full shrink-0"
          :disabled="!src"
          :aria-label="playing ? 'Pause' : 'Play'"
          @click="toggle"
        />
        <div class="min-w-0 flex-1">
          <p class="font-semibold truncate">{{ track.name }}</p>
          <p class="text-sm text-muted truncate">{{ track.artist || 'Unknown artist' }}</p>
          <p class="text-xs text-dimmed truncate">{{ meta }}</p>
        </div>
      </div>

      <div v-if="src" class="flex items-center gap-2 text-xs text-muted tabular-nums">
        <span>{{ time(position) }}</span>
        <USlider :model-value="position" :max="duration || 1" :step="1" size="sm" class="flex-1" @update:model-value="seek" />
        <span>{{ time(duration) }}</span>
      </div>
      <p v-else class="text-xs text-warning">No audio for this track in Dropbox</p>

      <slot name="hints" />

      <CrateInRow :in-piles="inPiles" :other-tags="otherTags" :path-label="pathLabel" @remove="(p) => emit('remove', p)" />

      <div class="flex items-center justify-between">
        <UButton icon="i-lucide-skip-back" variant="ghost" color="neutral" aria-label="Previous track" @click="emit('prev')" />
        <UButton icon="i-lucide-rotate-ccw" variant="ghost" color="neutral" label="15" :disabled="!src" @click="skip(-15)" />
        <UButton icon="i-lucide-rotate-cw" variant="ghost" color="neutral" label="15" :disabled="!src" @click="skip(15)" />
        <UButton icon="i-lucide-list-music" variant="ghost" color="neutral" aria-label="Track list" @click="emit('list')" />
        <UButton
          trailing-icon="i-lucide-arrow-right"
          label="Next"
          :variant="canNext ? 'solid' : 'soft'"
          @click="emit('next')"
        />
      </div>
    </div>
    <p v-else class="py-6 text-center text-sm text-muted">Nothing left here — pick a track from the list.</p>

    <audio
      ref="audio"
      :src="src ?? undefined"
      preload="metadata"
      @loadedmetadata="onLoaded"
      @timeupdate="position = audio?.currentTime ?? 0"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
    />
  </div>
</template>
