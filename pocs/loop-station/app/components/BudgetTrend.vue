<script setup lang="ts">
import type { HistoryRecord } from '../composables/useLoopData'
import { weeklyRows, latestDelta, idleStretches, describeTrend, shortDate, TOKENIZER_COLORS, type WeeklyRow } from '../utils/trend'

const props = defineProps<{ history: HistoryRecord[] }>()

// One row per ISO week (x axis ∝ time, so an idle stretch is an empty stretch) and
// one series per tokenizer (the Anthropic count and the heuristic are ~25% apart —
// one line put a fake ±4k step wherever the ruler changed) — #2389. Series differ
// by dash pattern as well as colour, so they can be told apart without colour.
const rows = computed<WeeklyRow[]>(() => weeklyRows(props.history))
const tokenizers = computed(() => Object.keys(TOKENIZER_COLORS).filter(t => rows.value.some(r => r[t] !== undefined)))
const categories = computed(() =>
  Object.fromEntries(tokenizers.value.map(t => [t, { name: t === 'heuristic' ? 'heuristic tokenizer (dashed)' : `${t} tokenizer`, color: TOKENIZER_COLORS[t] }]))
)
const dashes = computed(() => tokenizers.value.map(t => (t === 'heuristic' ? [6, 4] : [])))
const xFormatter = (i: number) => (rows.value[i] ? shortDate(rows.value[i]!.week) : '')
// Explicit y range over BOTH series — with gaps the library sizes the axis from the
// first series and clips the other.
const yDomain = computed<[number, number]>(() => {
  const vals = rows.value.flatMap(r => tokenizers.value.map(t => r[t]).filter((v): v is number => typeof v === 'number'))
  return [0, Math.ceil((Math.max(1000, ...vals) * 1.1) / 5000) * 5000]
})

// Headline: newest record vs the previous SAME-tokenizer record (the advisor's rule).
const head = computed(() => latestDelta(props.history))
const k = (n: number) => `${(n / 1000).toFixed(1)}k`
const deltaGlyph = computed(() => (head.value?.delta == null ? '' : head.value.delta > 0 ? '▲' : head.value.delta < 0 ? '▼' : '■'))
const deltaText = computed(() => {
  const d = head.value?.delta
  if (d == null) return `first ${head.value?.tokenizer} point — no comparable previous`
  return d === 0 ? 'no change' : `${k(Math.abs(d))} vs previous ${head.value!.tokenizer} point`
})
const deltaClass = computed(() => (head.value?.delta == null || head.value.delta === 0 ? 'is-flat' : head.value.delta > 0 ? 'is-up' : 'is-down'))
const gaps = computed(() => idleStretches(rows.value, tokenizers.value))
const description = computed(() => describeTrend(props.history))
</script>

<template>
  <div class="trend">
    <div class="trend__head">
      <div class="trend__big">
        {{ head ? k(head.tokens) : '—' }} <span class="trend__unit">tok</span>
      </div>
      <div
        v-if="head"
        class="trend__meta"
      >
        <span
          class="trend__tok"
          :style="{ color: TOKENIZER_COLORS[head.tokenizer] }"
        >{{ head.tokenizer }}</span>
        <span
          class="trend__delta"
          :class="deltaClass"
        ><span aria-hidden="true">{{ deltaGlyph }}</span> {{ deltaText }}</span>
      </div>
    </div>
    <ClientOnly>
      <div
        v-if="rows.length >= 2"
        role="img"
        :aria-label="description"
      >
        <LineChart
          :data="rows"
          :height="160"
          :categories="categories"
          :x-formatter="xFormatter"
          :x-num-ticks="Math.min(rows.length, 6)"
          :y-domain="yDomain"
          :y-num-ticks="4"
          :line-dash-array="dashes"
        />
      </div>
      <p
        v-else
        class="trend__empty"
      >
        Only {{ rows.length }} data point{{ rows.length === 1 ? '' : 's' }} so far — the trend grows one
        point per merge that touches <code>CLAUDE.md</code> (or a file it imports) / skills / agents.
      </p>
    </ClientOnly>
    <p
      v-if="gaps.length"
      class="trend__gaps"
    >
      <span
        v-for="g in gaps"
        :key="g.from"
      >no records {{ shortDate(g.from) }} → {{ shortDate(g.to) }} ({{ g.weeks }} weeks, no merges)</span>
    </p>
    <p class="trend__note">
      x axis = calendar weeks · one point per week (latest merge that week) · one line per tokenizer
    </p>
  </div>
</template>

<style scoped>
.trend { display: grid; gap: 8px; }
.trend__head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.trend__big { font-family: var(--mono); font-size: 28px; letter-spacing: .02em; }
.trend__unit { font-size: 12px; color: var(--ko-text); opacity: .8; }
.trend__meta { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 12px; }
.trend__tok { font-family: var(--mono); text-transform: uppercase; letter-spacing: .1em; font-size: 12px; }
.trend__delta { font-family: var(--mono); }
.is-up { color: var(--ko-accent-red); }
.is-down { color: var(--ko-accent-green); }
.is-flat { color: var(--ko-text); opacity: .8; }
.trend__empty, .trend__note { margin: 0; font-size: 12px; color: var(--ko-text); opacity: .75; }
.trend__gaps { margin: 0; font-size: 12px; color: var(--ko-accent-orange); display: flex; flex-wrap: wrap; gap: 12px; }
</style>
