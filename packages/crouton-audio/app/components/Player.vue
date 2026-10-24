<script setup lang="ts">
import type { AudioPlayerOptions } from '#crouton-audio/types/player'

const props = withDefaults(defineProps<{
  /** Audio file URL */
  src: string
  /** Unique player ID (for multiple players on one page) */
  playerId?: string
  /** WaveSurfer options */
  options?: AudioPlayerOptions
  /** Show built-in controls */
  controls?: boolean
}>(), {
  playerId: 'default',
  controls: true,
})

const emit = defineEmits<{
  ready: []
  play: []
  pause: []
  seek: [time: number]
  'region-click': [region: any]
  'region-update': [region: any]
}>()

const player = useAudioPlayer(props.playerId, props.options ?? {})
const waveformRef = ref<HTMLElement | null>(null)

onMounted(async () => {
  if (waveformRef.value) {
    await player.init(waveformRef, props.src)

    // Forward events
    if (player.instance.value) {
      player.instance.value.on('ready', () => emit('ready'))
      player.instance.value.on('play', () => emit('play'))
      player.instance.value.on('pause', () => emit('pause'))
      player.instance.value.on('seeking', () => emit('seek', player.currentTime.value))
    }

    if (player.regions.value) {
      player.regions.value.on('region-clicked', (region: any, e: MouseEvent) => {
        e.stopPropagation()
        emit('region-click', region)
      })
      player.regions.value.on('region-updated', (region: any) => {
        emit('region-update', region)
      })
    }
  }
})

// Watch for src changes
watch(() => props.src, async (newSrc) => {
  if (player.instance.value) {
    player.destroy()
    await nextTick()
    if (waveformRef.value) {
      await player.init(waveformRef, newSrc)
    }
  }
})

onUnmounted(() => {
  player.destroy()
})

// Expose player for parent components
defineExpose({
  player,
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Waveform -->
    <div class="relative">
      <div
        ref="waveformRef"
        class="h-full min-h-24"
        :class="{ 'opacity-0': player.loadingProgress.value === 0 }"
      />

      <!-- Loading overlay -->
      <div
        v-if="!player.isReady.value"
        class="absolute inset-0 flex items-center justify-center px-4"
      >
        <UProgress
          :value="player.loadingProgress.value || undefined"
          animation="carousel"
          class="w-full max-w-xs"
        />
      </div>
    </div>

    <!-- Controls slot or built-in controls -->
    <slot
      name="controls"
      :player="player"
    >
      <CroutonAudioControls
        v-if="controls"
        :player-id="playerId"
      />
    </slot>
  </div>
</template>
