<script setup lang="ts">
import type { UsageSource } from '~/composables/useLoopData'

const props = defineProps<{
  rows: { name: string; tokens: number; invocations: number }[]
  source: UsageSource
}>()

// Dead weight = big AND provably never invoked. The size threshold is the
// scorecard's "oversized skill" amber line (4k tok) — same ruler as WS1.
// Verdict policy (#1065): only the CI rollup (real counts, stated window) may
// call something dead weight. A single local session under-counts → no verdict.
// Sample data proves nothing → size only, no counts shown at all.
const BIG = 4000
const canJudge = computed(() => props.source.kind === 'ci')
const hasCounts = computed(() => props.source.kind !== 'sample')
const isDead = (r: { tokens: number; invocations: number }) =>
  canJudge.value && r.tokens >= BIG && r.invocations === 0

const sorted = computed(() =>
  [...props.rows].sort((a, b) => Number(isDead(b)) - Number(isDead(a)) || b.tokens - a.tokens).slice(0, 14)
)
const deadCount = computed(() => props.rows.filter(isDead).length)
const k = (n: number) => (n / 1000).toFixed(1) + 'k'
</script>

<template>
  <div class="inv">
    <p v-if="canJudge" class="inv__note">
      <strong>{{ deadCount }}</strong> dead-weight skill{{ deadCount === 1 ? '' : 's' }}
      <span class="inv__sub">(≥{{ k(BIG) }} tok · 0 invocations in {{ source.windowDays ?? '?' }}d · {{ source.scope ?? 'pipeline' }} scope)</span>
    </p>
    <p v-else-if="source.kind === 'local'" class="inv__note">
      <span class="pill pill-src">local session only</span>
      <span class="inv__sub">counts from one session — under-counts real usage; no dead-weight verdicts</span>
    </p>
    <p v-else class="inv__note">
      <span class="pill pill-src pill-src--warn">⚠ sample data</span>
      <span class="inv__sub">no usage data — showing size only; verdicts disabled</span>
    </p>
    <table class="inv__table">
      <thead>
        <tr><th>Skill</th><th class="num">Tokens</th><th class="num">Calls</th><th>Status</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in sorted" :key="r.name" :class="{ dead: isDead(r) }">
          <td class="inv__name">{{ r.name }}</td>
          <td class="num">{{ k(r.tokens) }}</td>
          <td class="num">{{ hasCounts ? r.invocations : '—' }}</td>
          <td>
            <span v-if="!hasCounts" class="pill pill-none">no data</span>
            <span v-else-if="isDead(r)" class="pill pill-dead">dead weight</span>
            <span v-else-if="r.invocations === 0" class="pill pill-idle">{{ canJudge ? 'unused' : '0 · session' }}</span>
            <span v-else class="pill pill-live">{{ r.invocations }}×</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="canJudge" class="inv__caveat">
      Counts from the committed usage rollup ({{ source.label }}) — interactive sessions aren't covered yet, so "0" means never fired <em>in CI</em>.
    </p>
    <p v-else class="inv__caveat">
      Dead-weight verdicts need the cross-run usage rollup (#1064) — until it lands, this panel names its source instead of guessing.
    </p>
  </div>
</template>

<style scoped>
.inv__note { font-size: 12px; color: var(--ko-text-muted); margin: 0 0 10px; }
.inv__note strong { color: var(--ko-accent-orange); font-family: var(--mono); }
.inv__sub { color: var(--ko-text-label); }
.inv__table { width: 100%; border-collapse: collapse; }
th { text-align: left; color: #44515f; font-weight: 500; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; padding: 6px 8px; border-bottom: 1px solid #2a2a2a; }
td { padding: 7px 8px; border-bottom: 1px solid #1c1c1c; font-family: var(--mono); font-size: 12px; color: var(--ko-text-muted); }
.inv__name { font-family: var(--sans); color: var(--ko-text-light); }
.num { text-align: right; }
tr.dead td { background: rgba(241,38,24,0.07); }
.pill { display: inline-block; padding: 1px 7px; border-radius: 20px; font-size: 10px; font-family: var(--mono); }
.pill-dead { background: rgba(241,38,24,0.15); color: var(--ko-accent-red); }
.pill-idle { background: rgba(250,95,40,0.12); color: var(--ko-accent-orange); }
.pill-live { background: rgba(52,211,153,0.12); color: #34d399; }
.pill-none { background: rgba(90,102,117,0.15); color: var(--ko-text-label); }
.pill-src { background: rgba(34,211,238,0.1); color: #22d3ee; }
.pill-src--warn { background: rgba(250,95,40,0.12); color: var(--ko-accent-orange); }
.inv__caveat { margin: 10px 0 0; font-size: 10.5px; color: var(--ko-text-label); }
</style>
