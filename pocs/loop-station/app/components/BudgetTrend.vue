<script setup lang="ts">
import type { HistoryRecord } from '~/composables/useLoopData'

const props = defineProps<{ history: HistoryRecord[] }>()

// nuxt-charts LineChart wants an array of row objects; we plot the always-on
// budget per recorded merge. (nuxt-charts is the same lib crouton-charts wraps —
// we use it directly since this is a static viewer, not a collection.)
const rows = computed(() =>
  props.history.map((r, i) => ({
    i,
    tokens: r.totals?.alwaysOnTokens ?? 0,
    label: r.commit ? r.commit.slice(0, 7) : String(i)
  }))
)
const categories = { tokens: { name: 'always-on tokens', color: 'var(--ko-accent-orange)' } }
const xFormatter = (i: number) => rows.value[i]?.label ?? ''

const latest = computed(() => rows.value[rows.value.length - 1]?.tokens ?? 0)
const prev = computed(() => (rows.value.length >= 2 ? rows.value[rows.value.length - 2]?.tokens ?? null : null))
const delta = computed(() => (prev.value == null ? null : latest.value - prev.value))
const k = (n: number) => (n / 1000).toFixed(1) + 'k'
</script>

<template>
  <div class="trend">
    <div class="trend__head">
      <div class="trend__big">{{ k(latest) }}<span class="trend__unit">tok</span></div>
      <div
        v-if="delta != null"
        class="trend__delta"
        :class="delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : 'is-flat'"
      >
        {{ delta > 0 ? '▲' : delta < 0 ? '▼' : '■' }} {{ delta === 0 ? 'no change' : k(Math.abs(delta)) }}
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
      />
      <p v-else class="trend__empty">
        Only {{ rows.length }} data point{{ rows.length === 1 ? '' : 's' }} so far — the trend grows one
        point per merge that touches <code>CLAUDE.md</code> (or a file it imports) / skills / agents.
      </p>
    </ClientOnly>
  </div>
</template>

<style scoped>
.trend__head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 8px; }
.trend__big { font-family: var(--mono); font-size: 34px; font-weight: 600; color: var(--ko-text-light); }
.trend__unit { font-size: 13px; color: var(--ko-text-label); margin-left: 4px; }
.trend__delta { font-family: var(--mono); font-size: 12px; }
.trend__delta.is-up { color: var(--ko-accent-orange); }
.trend__delta.is-down { color: var(--ko-accent-blue); }
.trend__delta.is-flat { color: var(--ko-text-label); }
.trend__empty { color: var(--ko-text-label); font-size: 12px; line-height: 1.5; }
.trend__empty code { font-family: var(--mono); color: var(--ko-text-muted); }
</style>
