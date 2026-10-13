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

const meta = computed(() => {
  const t = props.track
  if (!t) return ''
  return [t.bpm ? `${Math.round(t.bpm)} BPM` : null, t.tonality, t.year, t.genre].filter(Boolean).join(' · ')
})

function seek(seconds: number) {
  if (audio.value) audio.value.currentTime = seconds
}

watch(() => props.src, () => {
  position.value = 0
  duration.value = 0
})

defineExpose({ playSrc })
</script>

<template>
  <!-- Bottom pane, kassa-cart style: a borderless UCard, tight padding — every saved pixel
       goes to the pile list above. -->
  <UCard :ui="{ root: 'rounded-none ring-0 border-t border-default bg-elevated', body: 'space-y-1.5 p-3 sm:p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]' }">
    <template v-if="track">
      <div class="flex min-w-0 items-center gap-2.5">
        <UButton
          :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
          size="lg"
          class="shrink-0 rounded-full"
          :disabled="!src"
          :aria-label="playing ? 'Pause' : 'Play'"
          @click="toggle"
        />
        <div class="min-w-0 flex-1 leading-tight">
          <p class="truncate text-sm font-semibold">{{ track.name }} <span class="font-normal text-muted">· {{ track.artist || 'Unknown artist' }}</span></p>
          <p class="truncate text-xs text-dimmed">{{ meta }}</p>
        </div>
      </div>

      <CrateSeek v-if="src" :position="position" :duration="duration" @seek="seek" />
      <p v-else class="text-xs text-warning">No audio for this track in Dropbox</p>

      <slot name="hints" />

      <CrateInRow v-if="inPiles.length || otherTags.length" :in-piles="inPiles" :other-tags="otherTags" :path-label="pathLabel" @remove="(p) => emit('remove', p)" />

      <CrateTransport :has-audio="!!src" :can-next="canNext" @prev="emit('prev')" @skip="skip" @list="emit('list')" @next="emit('next')" />
    </template>
    <p v-else class="py-4 text-center text-sm text-muted">Nothing left here — pick a track from the list.</p>

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
  </UCard>
</template>
