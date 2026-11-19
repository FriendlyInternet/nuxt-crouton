<script setup lang="ts">
// A quiz card: tap A / B / C (or ? = not sure) per statement, then Send posts the `1B 2A 3C` line.
// Thin on purpose — the statements, the line and "can send" live in utils/quiz-core.ts.
import type { InboxCard } from '~/utils/inbox-core'
import { answerLine, canSend, PICKS, quizStatements, type QuizPick } from '~/utils/quiz-core'

const props = defineProps<{
  card: InboxCard
  send: (answer: string) => Promise<{ error: string | null }>
}>()

const statements = computed(() => quizStatements(props.card.payload))
const picks = ref<Record<number, QuizPick | undefined>>({})
const ready = computed(() => canSend(statements.value, picks.value))
const sending = ref(false)
const error = ref<string | null>(null)

function pick(n: number, p: QuizPick) {
  picks.value = { ...picks.value, [n]: p }
}

async function submit() {
  const line = answerLine(statements.value, picks.value)
  if (!line) return
  sending.value = true
  error.value = null
  const res = await props.send(line)
  sending.value = false
  error.value = res.error
}
</script>

<template>
  <CardsBody :card="card" badge="quiz">
    <div v-for="(s, i) in statements" :key="i" class="space-y-2">
      <p class="text-sm"><span class="font-semibold">{{ i + 1 }}.</span> {{ s.statement }}</p>
      <div class="grid grid-cols-4 gap-2">
        <UButton
          v-for="p in PICKS"
          :key="p"
          block
          size="lg"
          :label="p"
          :variant="picks[i + 1] === p ? 'solid' : 'outline'"
          :aria-pressed="picks[i + 1] === p"
          :aria-label="`Statement ${i + 1}: ${p === '?' ? 'not sure' : p}`"
          @click="pick(i + 1, p)"
        />
      </div>
      <ul class="space-y-1 text-sm text-muted">
        <li v-for="(c, j) in s.choices" :key="j"><span class="font-semibold">{{ PICKS[j] }}</span> — {{ c }}</li>
      </ul>
    </div>
    <a :href="card.link" target="_blank" rel="noopener" class="block text-sm text-primary">Open on GitHub</a>
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error" />
    <UButton block size="lg" icon="i-lucide-send" label="Send" :disabled="!ready" :loading="sending" @click="submit" />
  </CardsBody>
</template>
