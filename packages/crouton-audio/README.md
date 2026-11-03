# @fyit/crouton-audio

Audio player addon layer for Crouton with waveform visualization, powered by [WaveSurfer.js](https://wavesurfer.xyz/).

## Features

- Waveform visualization with customizable colors and bar styles
- Play/pause, seek, zoom controls
- Regions support (mark sections of audio)
- Multiple player instances on one page
- Nuxt UI 4 styled controls
- Fully reactive composable API

## Installation

```bash
pnpm add @fyit/crouton-audio
```

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-audio'
  ]
})
```

## Usage

### Basic Player

```vue
<CroutonAudioPlayer src="/audio/track.mp3" />
```

### Custom Controls

```vue
<CroutonAudioPlayer src="/audio/track.mp3" :controls="false">
  <template #controls="{ player }">
    <button @click="player.playPause()">
      {{ player.isPlaying.value ? 'Pause' : 'Play' }}
    </button>
  </template>
</CroutonAudioPlayer>
```

### Composable API

```vue
<script setup>
const player = useAudioPlayer('my-player', {
  waveColor: '#ccc',
  progressColor: '#3b82f6',
})

const container = ref(null)

onMounted(() => {
  player.init(container, '/audio/track.mp3')
})

onUnmounted(() => {
  player.destroy()
})
</script>
```

### Regions

```vue
<script setup>
const player = useAudioPlayer('editor', { enableRegions: true })

function markSection() {
  player.addRegion({
    id: 'intro',
    start: 0,
    end: 30,
    color: 'rgba(59, 130, 246, 0.2)',
  })
}
</script>
```

## Components

| Component | Description |
|-----------|-------------|
| `CroutonAudioPlayer` | Full player with waveform and controls |
| `CroutonAudioControls` | Standalone controls (play/pause, zoom, duration) |

## Composables

| Composable | Description |
|------------|-------------|
| `useAudioPlayer(id, options)` | Manages a WaveSurfer instance with reactive state |
