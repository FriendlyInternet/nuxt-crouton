<script setup lang="ts">
import type { CratePile } from '~/composables/useCrate'
import type { HintSource, HintWord } from '~/composables/useCrateHints'

defineProps<{
  sources: HintSource[]
  suggestions: CratePile[]
  pathLabel: (p: CratePile) => string
  isInPile: (pileId: string) => boolean
}>()
const emit = defineEmits<{ word: [word: HintWord], file: [pile: CratePile] }>()
</script>

<template>
  <!-- Two fixed-height rows that scroll sideways (owner's call), so the card never grows.
       The right edge fades out to show there's more — a hard cut read as "cut off" before. -->
  <div class="min-w-0 space-y-2">
    <CrateScrollRow v-if="suggestions.length">
      <UButton
        v-for="p in suggestions"
        :key="p.id"
        size="sm"
        variant="soft"
        :title="pathLabel(p)"
        class="shrink-0"
        @click="emit('file', p)"
      >
        {{ p.name }}
      </UButton>
    </CrateScrollRow>
    <CrateScrollRow v-if="sources.length" class="text-xs">
      <template v-for="s in sources" :key="s.label">
        <ULink :to="s.url ?? undefined" target="_blank" class="shrink-0 ps-1 text-muted underline-offset-2 hover:underline">{{ s.label }}</ULink>
        <CrateHintWord v-for="w in s.words" :key="w.word" :word="w" :ticked="!!w.pileId && isInPile(w.pileId)" class="shrink-0" @pick="emit('word', w)" />
      </template>
    </CrateScrollRow>
  </div>
</template>
