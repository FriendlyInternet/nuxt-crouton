# CLAUDE.md - @fyit/crouton-audio

## Package Purpose

Audio player addon for Nuxt Crouton. Wraps WaveSurfer.js with a Vue composable and ready-to-use components for waveform visualization, playback controls, regions, and zoom.

## Key Files

| File | Purpose |
|------|---------|
| `app/components/Player.vue` | `CroutonAudioPlayer` - Full player with waveform + controls |
| `app/components/Controls.vue` | `CroutonAudioControls` - Standalone playback controls |
| `app/composables/useAudioPlayer.ts` | Core composable managing WaveSurfer instance |
| `app/types/player.ts` | TypeScript type definitions |
| `app/app.config.ts` | Registers with `croutonApps` as `audio` |
| `nuxt.config.ts` | Layer configuration |

## Components

### CroutonAudioPlayer

Full player with waveform visualization and optional built-in controls.

```vue
<CroutonAudioPlayer src="/audio/track.mp3" />

<!-- Custom controls -->
<CroutonAudioPlayer src="/audio/track.mp3" :controls="false">
  <template #controls="{ player }">
    <button @click="player.playPause()">Play/Pause</button>
  </template>
</CroutonAudioPlayer>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | - | Audio file URL (required) |
| `playerId` | `string` | `'default'` | Unique ID for multiple players |
| `options` | `AudioPlayerOptions` | `{}` | WaveSurfer config |
| `controls` | `boolean` | `true` | Show built-in controls |

**Events:** `ready`, `play`, `pause`, `seek`, `region-click`, `region-update`

### CroutonAudioControls

Standalone controls: play/pause, zoom +/-, duration display.

```vue
<CroutonAudioControls player-id="my-player" />
```

**Props:** `playerId`, `showZoom`, `showDuration`

## Composables

### useAudioPlayer

```typescript
const player = useAudioPlayer('my-player', {
  waveColor: '#ccc',
  progressColor: '#3b82f6',
  enableRegions: true,
  enableZoom: true,
})

// Lifecycle
await player.init(containerRef, '/audio/track.mp3')
player.destroy()

// Playback
player.playPause()
player.play()
player.pause()
player.seekTo(30) // seconds

// Zoom
player.setZoom('+')
player.setZoom('-')

// Regions
player.addRegion({ id: 'intro', start: 0, end: 30 })
player.removeRegion('intro')
player.clearRegions()

// Reactive state (all readonly)
player.isReady
player.isPlaying
player.currentTime
player.duration
player.currentTimeFormatted  // "01:23"
player.durationFormatted     // "04:56"
player.loadingProgress       // 0-100
player.zoom
```

## Types

```typescript
interface AudioPlayerOptions {
  waveColor?: string
  progressColor?: string
  cursorColor?: string
  height?: number | 'auto'
  barWidth?: number
  barGap?: number
  barRadius?: number
  minPxPerSec?: number
  normalize?: boolean
  dragToSeek?: boolean
  autoScroll?: boolean
  autoCenter?: boolean
  hideScrollbar?: boolean
  enableZoom?: boolean
  enableRegions?: boolean
}

interface AudioRegion {
  id: string
  start: number
  end?: number
  color?: string
  drag?: boolean
  resize?: boolean
  content?: string
}
```

## Component Naming

Components auto-import with `CroutonAudio` prefix:
- `Player.vue` → `<CroutonAudioPlayer />`
- `Controls.vue` → `<CroutonAudioControls />`

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@fyit/crouton-core', '@fyit/crouton-audio']
})
```

## Dependencies

- **Requires**: `wavesurfer.js ^7.12.2`
- **Peer deps**: `@fyit/crouton-core`, `@nuxt/ui ^4.3.0`, `@nuxt/icon ^1.0.0`, `nuxt ^4.0.0`
