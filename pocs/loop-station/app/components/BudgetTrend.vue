<script setup lang="ts">
import type { HistoryRecord } from '../composables/useLoopData'
import { weeklyRows, latestDelta, TOKENIZER_COLORS, type WeeklyRow } from '../utils/trend'

const props = defineProps<{ history: HistoryRecord[] }>()

// One row per ISO week from the first record to the last, so the x axis is
// proportional to TIME — a stretch with no merges shows as an empty stretch,
// not as two adjacent points. One series per tokenizer: the Anthropic API count
// and the offline heuristic are ~25% apart, so drawing them as one line put a
// fake ±4k step wherever the ruler changed (#2389).
const rows = computed<WeeklyRow[]>(() => weeklyRows(props.history))
const tokenizers = computed(() => Object.keys(TOKENIZER_COLORS).filter((t) => rows.value.some((r) => r[t] !== undefined)))
const categories = computed(() =>
  Object.fromEntries(tokenizers.value.map((t) => [t, { name: `${t} tokenizer`, color: TOKENIZER_COLORS[t] }]))
)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const xFormatter = (i: number) => {
  const w = rows.value[i]?.week
  return w ? `${Number(w.slice(8, 10))} ${MONTHS[Number(w.slice(5, 7)) - 1]}` : ''
}
// Explicit y range over BOTH series — with gaps in the data the library otherwise
// sizes the axis from the first series and clips the other.
const yDomain = computed<[number, number]>(() => {
  const vals = rows.value.flatMap((r) => tokenizers.value.map((t) => r[t]).filter((v): v is number => typeof v === 'number'))
  const max = Math.max(1000, ...vals)
  return [0, Math.ceil((max * 1.1) / 5000) * 5000]
})

// Headline: the newest record, compared ONLY to the previous record measured with
// the same tokenizer (the advisor's rule — a cross-tokenizer delta is noise).
const head = computed(() => latestDelta(props.history))
const k = (n: number) => (n / 1000).toFixed(1) + 'k'

// Gaps worth naming: ≥ 4 consecutive empty weeks.
const gaps = computed(() => {
  const out: { from: string; to: string; weeks: number }[] = []
  let start = -1
  rows.value.forEach((r, i) => {
    const empty = tokenizers.value.every((t) => r[t] === undefined)
    if (empty && start < 0) start = i
    if ((!empty || i === rows.value.length - 1) && start >= 0) {
      const end = empty ? i : i - 1
      const weeks = end - start + 1
      if (weeks >= 4) out.push({ from: rows.value[start]!.week, to: rows.value[end]!.week, weeks })
      start = -1
    }
  })
  return out
})
</script>

<template>
  <div class="trend">
    <div class="trend__head">
      <div class="trend__big">{{ head ? k(head.tokens) : '—' }}<span class="trend__unit">tok</span></div>
      <div v-if="head" class="trend__meta">
        <span class="trend__tok" :style="{ color: TOKENIZER_COLORS[head.tokenizer] }">{{ head.tokenizer }}</span>
        <span
          v-if="head.delta != null"
          class="trend__delta"
          :class="head.delta > 0 ? 'is-up' : head.delta < 0 ? 'is-down' : 'is-flat'"
        >
          {{ head.delta > 0 ? '▲' : head.delta < 0 ? '▼' : '■' }} {{ head.delta === 0 ? 'no change' : k(Math.abs(head.delta)) }}
          <span class="trend__since">vs previous {{ head.tokenizer }} point</span>
        </span>
        <span v-else class="trend__delta is-flat">first {{ head.tokenizer }} point — no comparable previous</span>
      </div>
    </div>
    <ClientOnly>
      <LineChart
        v-if="rows.length >= 2"
        :data="rows"
        :height="160"
        :categories="categories"
        :x-formatter="xFormatter"
        :x-num-ticks="Math.min(rows.length, 6)"
        :y-domain="yDomain"
        :y-num-ticks="4"
      />
      <p v-else class="trend__empty">
        Only {{ rows.length }} data point{{ rows.length === 1 ? '' : 's' }} so far — the trend grows one
        point per merge that touches <code>CLAUDE.md</code> (or a file it imports) / skills / agents.
      </p>
    </ClientOnly>
    <p v-if="gaps.length" class="trend__gaps">
      <span v-for="g in gaps" :key="g.from">no records {{ g.from }} → {{ g.to }} ({{ g.weeks }} weeks, no merges)</span>
    </p>
    <p class="trend__note">x axis = calendar weeks · one point per week (latest merge that week) · one line per tokenizer</p>
  </div>
</template>

<style scoped>
.trend { display: grid; gap: 8px; }
.trend__head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.trend__big { font-family: var(--mono); font-size: 28px; letter-spacing: .02em; }
.trend__unit { font-size: 12px; margin-left: 4px; color: var(--ko-text-label); }
.trend__meta { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 12px; }
.trend__tok { font-family: var(--mono); text-transform: uppercase; letter-spacing: .1em; font-size: 10px; }
.trend__delta { font-family: var(--mono); }
.trend__since { color: var(--ko-text-label); margin-left: 6px; }
.is-up { color: var(--ko-accent-red); }
.is-down { color: var(--ko-accent-green); }
.is-flat { color: var(--ko-text-label); }
.trend__empty, .trend__note, .trend__gaps { margin: 0; font-size: 11px; color: var(--ko-text-label); }
.trend__gaps { color: var(--ko-accent-orange); display: flex; flex-wrap: wrap; gap: 12px; }
</style>
