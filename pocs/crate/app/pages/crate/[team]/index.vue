<script setup lang="ts">
import type { CratePile, CrateTrack } from '~/composables/useCrate'
import type { HintWord } from '~/composables/useCrateHints'

definePageMeta({ layout: false, middleware: ['auth'] })
useHead({ title: 'Crate', meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }] })

const crate = useCrate()
const toast = useToast()
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
  pin() // the deck keeps its track while you look around other piles
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
/** Pin the shown track before acting on it or navigating, so the deck never swaps by itself. */
function pin() {
  if (!currentId.value && current.value) currentId.value = current.value.id
}
function togglePile(pile: CratePile) {
  if (!current.value) return
  pin()
  toggle(current.value, pile)
}

const deck = ref<{ playSrc: (url: string) => void, pause: () => void }>()

// ── Listen to a pile (#2221) ──────────────────────────────────────────────
const listener = ref<{ show: (p: CratePile, tracks: CrateTrack[]) => void, start: () => void }>()
/** Open the listening sheet for `pile` (the current level by default). */
function openListen(pile: CratePile | null = level.value) {
  if (!pile) return
  const playable = tracks.value.filter(t => t.hasAudio && t.id !== current.value?.id && isIn(t, pile))
  if (!playable.length) return toast.add({ title: `Nothing to play in ${pile.name} yet` })
  listener.value?.show(pile, playable)
}
/** Header 🎧: open + play at once — it's a tap, so iOS lets it start. */
function listen() {
  openListen()
  listener.value?.start()
}

function show(track: CrateTrack | undefined, autoplay: boolean) {
  if (!track) return
  currentId.value = track.id
  const at = trayTracks.value.findIndex(t => t.id === track.id)
  if (at >= 0) trayIndex.value = at
  if (autoplay && track.hasAudio) deck.value?.playSrc(audioUrl(track))
}
function next() {
  pin()
  const list = trayTracks.value
  const at = list.findIndex(t => t.id === currentId.value)
  // Still in the tray → the one after it; filed away → whatever now sits where it was.
  const target = at >= 0 ? at + 1 : trayIndex.value
  show(list[Math.min(list.length - 1, target)], true)
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

// ── Add new tracks (#2237): upload → inbox; the deck jumps to the first new one ──
const { upload, progress: uploadProgress } = useCrateUpload(crate)
const fileInput = ref<HTMLInputElement>()
async function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const added = await upload([...(input.files ?? [])])
  input.value = ''
  if (added.length) {
    openLevel(null)
    show(tracks.value.find(t => t.id === added[0]!.id), false)
  }
}
</script>

<template>
  <div class="flex h-dvh flex-col overflow-x-hidden bg-default text-default">
    <CrateHeader
      :trail="trail"
      :tray-label="trayLabel"
      :tray-count="trayTracks.length"
      :uploading="uploadProgress"
      @open="openLevel"
      @up="goUp"
      @undo="crate.undo()"
      @list="listOpen = true"
      @listen="listen"
      @upload="fileInput?.click()"
    />
    <input ref="fileInput" type="file" accept="audio/*,.mp3,.m4a,.aac,.aif,.aiff,.wav,.flac,.ogg" multiple class="hidden" @change="onFiles">
    <UProgress
      v-if="uploadProgress"
      :model-value="uploadProgress.total ? uploadProgress.done : null"
      :max="uploadProgress.total || 1"
      size="xs"
      :aria-label="`Uploading ${uploadProgress.name}`"
    />

    <main ref="main" class="flex-1 overflow-y-auto p-2">
      <div v-if="status === 'error'" class="py-10 text-center text-error">
        Couldn’t load your library. <UButton variant="link" label="Retry" @click="crate.refresh()" />
      </div>
      <div v-else-if="!crate.piles.value.length" class="py-10 text-center text-muted">Loading your library…</div>
      <UCard v-else variant="soft" :ui="{ body: 'p-0 sm:p-0' }">
        <div class="divide-y divide-default/60 md:grid md:grid-cols-2 md:divide-y-0 lg:grid-cols-3">
          <CratePileRow
            v-for="pile in shownPiles"
            :key="pile.id"
            :pile="pile"
            :count="counts.get(pile.id) ?? 0"
            :ticked="!!current && isIn(current, pile)"
            :disabled="!current"
            :glow="hints.glow(pile)"
            @toggle="togglePile(pile)"
            @open="openLevel(pile)"
          />
          <UButton
            variant="ghost"
            color="neutral"
            icon="i-lucide-plus"
            label="New pile"
            class="w-full rounded-none px-3 py-2 text-muted"
            @click="newPile?.start({ parentId: levelId })"
          />
        </div>
      </UCard>
    </main>

    <CrateDeck
      ref="deck"
      :track="current"
      :src="current?.hasAudio ? audioUrl(current) : null"
      :in-piles="inPiles"
      :other-tags="deckOther"
      :path-label="pathLabel"
      :can-next="inPiles.length > 0"
      @next="next"
      @remove="removeFromDeck"
    >
      <template #hints>
        <CrateHints
          :sources="hints.sources.value"
          :suggestions="hints.suggestions.value"
          :path-label="pathLabel"
          :is-in-pile="(id) => !!current && isIn(current, crate.piles.value.find(p => p.id === id)!)"
          :empty="hints.empty.value"
          @word="onWord"
          @file="fileSuggestion"
          @hold="openListen"
          @listen="listener?.start()"
          @new="newPile?.start({ parentId: levelId })"
        />
      </template>
    </CrateDeck>

    <CratePileListen ref="listener" :audio-url="audioUrl" :path-label="pathLabel" @started="deck?.pause()" />

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
