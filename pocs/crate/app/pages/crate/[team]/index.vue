<script setup lang="ts">
import type { CratePile, CrateTrack } from '~/composables/useCrate'
import type { HintWord } from '~/composables/useCrateHints'

definePageMeta({ layout: false, middleware: ['auth'] })
useHead({ title: 'Crate', meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }] })

const crate = useCrate()
const { status, children, ancestors, pathLabel, counts, isIn, leafPiles, otherTags, tray, toggle, takeOutOf, audioUrl, tracks } = crate

// ── Level (which pile we're inside) ───────────────────────────────────────
const levelId = ref<string | null>(null)
const level = computed(() => crate.piles.value.find(p => p.id === levelId.value) ?? null)
const shownPiles = computed(() => children(levelId.value))
const trail = computed(() => level.value ? [...ancestors(level.value), level.value] : [])
const trayTracks = computed(() => tray(level.value))
const main = ref<HTMLElement>()
function goUp() {
  const parentId = level.value?.parentId
  openLevel(parentId ? crate.piles.value.find(p => p.id === parentId) ?? null : null)
}
function openLevel(pile: CratePile | null) {
  levelId.value = pile?.id ?? null
  main.value?.scrollTo({ top: 0 })
}

// ── The deck holds its track by id: filing it removes it from the tray, but it stays put ──
const currentId = ref<string | null>(null)
const trayIndex = ref(0) // where the current track sat in the tray, so Next continues from there
// Until a track is picked, the deck shows the first one in the tray.
const current = computed<CrateTrack | null>(() => currentId.value
  ? tracks.value.find(t => t.id === currentId.value) ?? null
  : trayTracks.value[0] ?? null)
/** Pin the shown track before acting on it, so filing it doesn't swap the deck. */
function pin() {
  if (!currentId.value && current.value) currentId.value = current.value.id
}
function togglePile(pile: CratePile) {
  if (!current.value) return
  pin()
  toggle(current.value, pile)
}

const deck = ref<{ playSrc: (url: string) => void }>()
function show(track: CrateTrack | undefined, autoplay: boolean) {
  if (!track) return
  currentId.value = track.id
  const at = trayTracks.value.findIndex(t => t.id === track.id)
  if (at >= 0) trayIndex.value = at
  if (autoplay && track.hasAudio) deck.value?.playSrc(audioUrl(track))
}
function step(delta: 1 | -1) {
  pin()
  const list = trayTracks.value
  const at = list.findIndex(t => t.id === currentId.value)
  // Still in the tray → its neighbour; filed away → whatever now sits where it was.
  const target = at >= 0 ? at + delta : (delta === 1 ? trayIndex.value : trayIndex.value - 1)
  show(list[Math.max(0, Math.min(list.length - 1, target))], true)
}

// ── Genre hints + new piles (#2212) ───────────────────────────────────────
const hints = useCrateHints(crate, current)
const newPile = ref<{ start: (prefill?: { name?: string, parentId?: string | null }) => void }>()
const newPileOpen = ref(false)
function onWord(w: HintWord) {
  const pile = w.pileId ? crate.piles.value.find(p => p.id === w.pileId) : undefined
  if (pile) togglePile(pile)
  else newPile.value?.start({ name: w.word, parentId: w.parentId })
}
function fileSuggestion(pile: CratePile) {
  if (!current.value) return
  pin()
  crate.fileInto(current.value, pile)
}
async function onCreate(name: string, parentId: string | null, fileTrack: boolean) {
  if (fileTrack) pin()
  await crate.createPile(name, parentId, fileTrack ? current.value : null)
}

const inPiles = computed(() => current.value ? leafPiles(current.value) : [])
const deckOther = computed(() => current.value ? otherTags(current.value) : [])

// ── Track list ────────────────────────────────────────────────────────────
const listOpen = ref(false)
function removeFromDeck(pile: CratePile) {
  pin()
  if (current.value) takeOutOf(current.value, pile)
}
function pick(track: CrateTrack) {
  listOpen.value = false
  show(track, true)
}
const trayLabel = computed(() => level.value ? `Loose in ${level.value.name}` : 'Inbox')
</script>

<template>
  <div class="flex h-dvh flex-col overflow-x-hidden bg-default text-default">
    <CrateHeader
      :trail="trail"
      :tray-label="trayLabel"
      :tray-count="trayTracks.length"
      @open="openLevel"
      @up="goUp"
      @undo="crate.undo()"
      @list="listOpen = true"
    />

    <main ref="main" class="flex-1 overflow-y-auto px-3 py-3">
      <div v-if="status === 'error'" class="py-10 text-center text-error">
        Couldn’t load your library. <UButton variant="link" label="Retry" @click="crate.refresh()" />
      </div>
      <div v-else-if="!crate.piles.value.length" class="py-10 text-center text-muted">Loading your library…</div>
      <div v-else class="grid grid-cols-1 gap-1.5 md:grid-cols-2 lg:grid-cols-3">
        <CratePileRow
          v-for="pile in shownPiles"
          :key="pile.id"
          :pile="pile"
          :count="counts.get(pile.id) ?? 0"
          :ticked="!!current && isIn(current, pile)"
          :can-open="children(pile.id).length > 0"
          :disabled="!current"
          :glow="hints.glow(pile)"
          @toggle="togglePile(pile)"
          @open="openLevel(pile)"
        />
        <UButton
          block
          variant="outline"
          color="neutral"
          icon="i-lucide-plus"
          label="New pile"
          class="border-dashed py-2.5"
          @click="newPile?.start({ parentId: levelId })"
        />
      </div>
    </main>

    <CrateDeck
      ref="deck"
      :track="current"
      :src="current?.hasAudio ? audioUrl(current) : null"
      :in-piles="inPiles"
      :other-tags="deckOther"
      :path-label="pathLabel"
      :can-next="inPiles.length > 0"
      @next="step(1)"
      @prev="step(-1)"
      @list="listOpen = true"
      @remove="removeFromDeck"
    >
      <template #hints>
        <CrateHints
          :sources="hints.sources.value"
          :suggestions="hints.suggestions.value"
          :path-label="pathLabel"
          :is-in-pile="(id) => !!current && isIn(current, crate.piles.value.find(p => p.id === id)!)"
          @word="onWord"
          @file="fileSuggestion"
        />
      </template>
    </CrateDeck>

    <CrateNewPile ref="newPile" v-model:open="newPileOpen" :piles="crate.piles.value" :path-label="pathLabel" :track="current" @create="onCreate" />

    <CrateTrackList
      v-model:open="listOpen"
      :title="trayLabel"
      :tray="trayTracks"
      :search-pool="level ? null : tracks"
      :current-id="currentId"
      @pick="pick"
    />
  </div>
</template>
