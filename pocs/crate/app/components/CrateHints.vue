<script setup lang="ts">
import type { CratePile } from '~/composables/useCrate'
import type { HintSource, HintWord } from '~/composables/useCrateHints'

defineProps<{
  sources: HintSource[]
  suggestions: CratePile[]
  pathLabel: (p: CratePile) => string
  isInPile: (pileId: string) => boolean
  empty: boolean
}>()
const emit = defineEmits<{ word: [word: HintWord], file: [pile: CratePile], hold: [pile: CratePile], listen: [], new: [] }>()
</script>

<template>
  <!-- Two fixed-height rows that scroll sideways (owner's call), so the card never grows.
       The right edge fades out to show there's more — a hard cut read as "cut off" before. -->
  <div class="min-w-0 space-y-2">
    <!-- Nothing found online: say so, and offer the one thing left — name a pile yourself. -->
    <div v-if="empty" class="flex items-center gap-1.5 text-xs text-muted">
      <span class="ps-1">No genre found online</span>
      <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-plus" label="New pile" @click="emit('new')" />
    </div>
    <CrateScrollRow v-if="suggestions.length">
      <CrateSuggestionChip
        v-for="p in suggestions"
        :key="p.id"
        :pile="p"
        :title="pathLabel(p)"
        @file="emit('file', p)"
        @hold="emit('hold', p)"
        @release="emit('listen')"
      />
    </CrateScrollRow>
    <!-- One row per source (Discogs, Bandcamp…), stacked, each scrolling sideways on its own. -->
    <CrateScrollRow v-for="s in sources" :key="s.label" class="text-xs">
      <ULink :to="s.url ?? undefined" target="_blank" class="shrink-0 ps-1 text-muted underline-offset-2 hover:underline">{{ s.label }}</ULink>
      <CrateHintWord v-for="w in s.words" :key="w.word" :word="w" :ticked="!!w.pileId && isInPile(w.pileId)" class="shrink-0" @pick="emit('word', w)" />
    </CrateScrollRow>
  </div>
</template>
