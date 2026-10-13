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
  <div class="min-w-0 space-y-1">
    <div v-if="suggestions.length" class="flex min-w-0 flex-wrap gap-1">
      <UButton
        v-for="p in suggestions"
        :key="p.id"
        size="xs"
        variant="soft"
        icon="i-lucide-sparkles"
        class="max-w-full"
        @click="emit('file', p)"
      >
        <span class="truncate">{{ pathLabel(p) }}</span>
      </UButton>
    </div>
    <p v-for="s in sources" :key="s.label" class="flex min-w-0 flex-wrap items-center gap-x-0.5 text-xs">
      <ULink :to="s.url ?? undefined" target="_blank" class="text-muted underline-offset-2 hover:underline">{{ s.label }}</ULink>
      <CrateHintWord v-for="w in s.words" :key="w.word" :word="w" :ticked="!!w.pileId && isInPile(w.pileId)" @pick="emit('word', w)" />
    </p>
  </div>
</template>
