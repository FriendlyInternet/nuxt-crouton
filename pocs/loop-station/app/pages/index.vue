<script setup lang="ts">
const { data, pending, error } = await useLoopData()

const k = (n: number) => (n / 1000).toFixed(1) + 'k'
const latest = computed(() => data.value?.latest ?? null)
const traceMeta = computed(() => data.value?.traceMeta ?? null)
const usageSource = computed(() => data.value?.usageSource ?? { kind: 'sample' as const, label: 'sample data' })

// KPI readouts (KoDisplay = 7-segment screens).
const kpis = computed(() => {
  const l = latest.value
  const evCount = data.value?.events.length ?? 0
  return [
    { label: 'ALWAYS-ON', value: l ? k(l.totals.alwaysOnTokens) : '—', unit: 'tok' },
    { label: 'REDUNDANCY', value: l ? `${l.redundancy.pct}` : '—', unit: '%' },
    { label: 'ARTIFACTS', value: l ? String(l.totals.artifactCount) : '—', unit: '' },
    { label: 'TRACE EVENTS', value: String(evCount), unit: '' }
  ]
})

const coldWrites = computed(() =>
  (latest.value?.coldWrites ?? []).slice().sort((a, b) => b.total - a.total).slice(0, 8)
)
const maxCold = computed(() => Math.max(1, ...coldWrites.value.map((c) => c.total)))
</script>

<template>
  <div class="station">
    <!-- header -->
    <header class="hdr">
      <div class="hdr__brand">
        <div class="hdr__logo"><KoLed color="green" state="alive" size="lg" /></div>
        <div>
          <h1 class="hdr__title">LOOP&nbsp;STATION</h1>
          <div class="hdr__sub">harness observatory · context budget × observed loops</div>
        </div>
      </div>
      <div class="hdr__meta">
        <span v-if="latest">commit {{ latest.commit?.slice(0, 7) }}</span>
        <span v-if="traceMeta">trace: {{ traceMeta.source || traceMeta.workflow || 'session' }} · {{ traceMeta.layout || '—' }}</span>
        <span class="hdr__live"><KoLed color="green" state="pulse" size="sm" /> read-only</span>
      </div>
    </header>

    <p v-if="error" class="err">Failed to load data: {{ String(error) }}</p>

    <!-- KPI row -->
    <section class="kpis">
      <KoPanel v-for="kpi in kpis" :key="kpi.label" class="kpi">
        <div class="kpi__inner">
          <div class="kpi__lbl">{{ kpi.label }}</div>
          <div class="kpi__val">{{ kpi.value }}<span class="kpi__unit">{{ kpi.unit }}</span></div>
        </div>
      </KoPanel>
    </section>

    <!-- budget + scorecard -->
    <section class="grid grid--2">
      <KoPanel class="panel">
        <div class="panel__inner">
          <h2 class="panel__h">Context budget · CLAUDE.md <span class="tag">tokens / merge</span></h2>
          <BudgetTrend :history="data?.history ?? []" />
        </div>
      </KoPanel>
      <KoPanel class="panel">
        <div class="panel__inner">
          <h2 class="panel__h">Scorecard <span class="tag">deterministic · bands</span></h2>
          <Scorecard v-if="latest" :record="latest" />
          <p v-else class="muted">No inventory record yet.</p>
        </div>
      </KoPanel>
    </section>

    <!-- loop graph -->
    <section>
      <KoPanel class="panel">
        <div class="panel__inner">
          <h2 class="panel__h">Loop graph · observed call topology
            <span class="tag">nodes ∝ invocations · edges = parent→child · ⟲ recursion</span></h2>
          <LoopGraph :nodes="data?.nodes ?? []" :edges="data?.edges ?? []" />
        </div>
      </KoPanel>
    </section>

    <!-- inventory + cold-write -->
    <section class="grid grid--2">
      <KoPanel class="panel">
        <div class="panel__inner">
          <h2 class="panel__h">Inventory · size × usage
            <span class="tag" :class="{ 'tag--warn': usageSource.kind === 'sample' }">{{
              usageSource.kind === 'sample' ? '⚠ sample data' : usageSource.label
            }}</span></h2>
          <InventoryTable :rows="data?.deadweight ?? []" :source="usageSource" />
        </div>
      </KoPanel>
      <KoPanel class="panel">
        <div class="panel__inner">
          <h2 class="panel__h">CI cold-write · per run <span class="tag">always-on + prompt</span></h2>
          <div v-if="coldWrites.length" class="cold">
            <div v-for="c in coldWrites" :key="c.workflow" class="cold__row">
              <span class="cold__name">{{ c.workflow }}</span>
              <div class="cold__track"><div class="cold__bar" :style="{ width: `${(c.total / maxCold) * 100}%` }" /></div>
              <span class="cold__val">{{ k(c.total) }}</span>
            </div>
          </div>
          <p v-else class="muted">No LLM workflows detected.</p>
        </div>
      </KoPanel>
    </section>

    <!-- trace timeline -->
    <section>
      <KoPanel class="panel">
        <div class="panel__inner">
          <h2 class="panel__h">Trace · one execution
            <span class="tag">depth-indented · durations</span></h2>
          <TraceTimeline :events="data?.events ?? []" :meta="traceMeta" />
        </div>
      </KoPanel>
    </section>

    <footer class="foot">
      Loop Station · WS3 (#931) of the observatory epic (#926). Renders WS1 inventory + WS2 trace — compute lives in the scripts.
    </footer>
  </div>
</template>

<style scoped>
.station { max-width: 1180px; margin: 0 auto; padding: 22px 22px 40px; }
.hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
.hdr__brand { display: flex; align-items: center; gap: 14px; }
.hdr__logo { width: 34px; height: 34px; border-radius: 8px; background: #171717; display: grid; place-items: center; box-shadow: var(--ko-shadow-drop); }
.hdr__title { margin: 0; font-family: var(--mono); font-size: 22px; font-weight: 700; letter-spacing: .06em; color: var(--ko-text-light); }
.hdr__sub { font-size: 11px; color: var(--ko-text-label); letter-spacing: .04em; }
.hdr__meta { display: flex; align-items: center; gap: 16px; font-family: var(--mono); font-size: 11px; color: var(--ko-text-label); }
.hdr__live { display: flex; align-items: center; gap: 6px; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 14px; }
.kpi__inner { padding: 4px 6px; }
.kpi__lbl { font-size: 10px; letter-spacing: .14em; color: var(--ko-text-label); }
.kpi__val { font-family: var(--mono); font-size: 28px; font-weight: 600; color: var(--ko-text-light); margin-top: 6px; }
.kpi__unit { font-size: 12px; color: var(--ko-text-label); margin-left: 4px; }
.grid { display: grid; gap: 14px; margin-bottom: 14px; }
.grid--2 { grid-template-columns: 1fr 1fr; }
.panel__inner { padding: 4px 8px 8px; width: 100%; }
.panel__h { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 14px; font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--ko-text-label); font-weight: 600; }
.panel__h .tag { color: #5a6675; letter-spacing: .03em; text-transform: none; font-family: var(--mono); font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel__h .tag--warn { color: var(--ko-accent-orange); }
.muted { color: var(--ko-text-label); font-size: 12px; }
.err { color: var(--ko-accent-red); font-family: var(--mono); font-size: 12px; }
.cold { display: flex; flex-direction: column; gap: 9px; }
.cold__row { display: flex; align-items: center; gap: 10px; }
.cold__name { font-family: var(--mono); font-size: 11px; color: var(--ko-text-muted); min-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cold__track { flex: 1; height: 7px; background: #0c0c0c; border-radius: 5px; overflow: hidden; }
.cold__bar { height: 100%; background: var(--ko-accent-blue); border-radius: 5px; }
.cold__val { font-family: var(--mono); font-size: 11px; color: var(--ko-text-label); min-width: 44px; text-align: right; }
.foot { margin-top: 22px; text-align: center; color: var(--ko-text-label); font-size: 10.5px; }
@media (max-width: 860px) {
  .kpis { grid-template-columns: repeat(2, 1fr); }
  .grid--2 { grid-template-columns: 1fr; }
}
</style>
