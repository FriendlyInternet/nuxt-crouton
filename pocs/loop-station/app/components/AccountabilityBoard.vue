<script setup lang="ts">
import type { Accountability } from '~/composables/useLoopData'

const props = defineProps<{ board: Accountability }>()

const authors = computed(() => props.board.authors ?? [])
const gates = computed(() => props.board.gates ?? [])
const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`)
const netClass = (n: number) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero')
</script>

<template>
  <div class="acc">
    <p class="acc__note">
      Every confirmed defect is severity-weighted: <strong>−w</strong> to the author,
      <strong>+w</strong> to the gate that caught it. A clean merge earns its author +1.
      <span class="acc__sub">{{ board.findingCount }} finding{{ board.findingCount === 1 ? '' : 's' }} · scores only when confirmed</span>
    </p>

    <div class="acc__cols">
      <!-- authors: worst-first -->
      <div class="acc__col">
        <div class="acc__ch">👷 Authors <span class="acc__chsub">worst-first · defect-rate</span></div>
        <table class="acc__table">
          <thead><tr><th>Flow</th><th class="num">Net</th><th class="num">Def</th><th class="num">Clean</th><th class="num">Rate</th></tr></thead>
          <tbody>
            <tr v-for="a in authors" :key="a.agent">
              <td class="acc__name">{{ a.agent }}</td>
              <td class="num"><span class="pill" :class="netClass(a.net)">{{ sign(a.net) }}</span></td>
              <td class="num">{{ a.defects }}</td>
              <td class="num">{{ a.clean }}</td>
              <td class="num">{{ Math.round(a.rate * 100) }}%</td>
            </tr>
            <tr v-if="!authors.length"><td colspan="5" class="acc__empty">No authored runs recorded yet.</td></tr>
          </tbody>
        </table>
      </div>

      <!-- gates: best-first -->
      <div class="acc__col">
        <div class="acc__ch">🔎 Review gates <span class="acc__chsub">best-first · net catches</span></div>
        <table class="acc__table">
          <thead><tr><th>Gate</th><th class="num">Net</th><th class="num">Catches</th><th class="num">False +</th></tr></thead>
          <tbody>
            <tr v-for="g in gates" :key="g.agent">
              <td class="acc__name">{{ g.agent }}</td>
              <td class="num"><span class="pill" :class="netClass(g.net)">{{ sign(g.net) }}</span></td>
              <td class="num">{{ g.catches }}</td>
              <td class="num">{{ g.falsePositives }}</td>
            </tr>
            <tr v-if="!gates.length"><td colspan="4" class="acc__empty">No findings recorded yet.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <details class="acc__guide">
      <summary>How to read this board</summary>
      <div class="acc__guidebody">
        <p>
          Two teams, scored against each other. Every <strong>confirmed</strong> defect is one
          severity-weighted transaction: the <strong>author</strong> flow that shipped it is debited
          <code>−w</code>, the <strong>gate</strong> that caught it is credited <code>+w</code>. A finding
          only counts once <strong>confirmed</strong> (fix merged / reverted / a human <code>lgtm</code>) —
          a <code>pending</code> finding moves nothing.
        </p>
        <p class="acc__weights">
          <strong>Weight <code>w</code> by severity:</strong> critical&nbsp;5 · high&nbsp;3 · medium&nbsp;2 · low&nbsp;1.
          A defect that <strong>escaped review</strong> and was caught later costs the author <code>2×w</code>
          (and debits the gate that should have caught it).
        </p>
        <ul class="acc__cols2">
          <li><strong>👷 Author · Net</strong> — running score: <code>+1</code> per clean merge, <code>−w</code> per defect. <em>Lower = ships more/worse defects.</em></li>
          <li><strong>Def</strong> — count of confirmed defects charged to this flow.</li>
          <li><strong>Clean</strong> — merged runs with <em>no</em> confirmed defect (each earned <code>+1</code>).</li>
          <li><strong>Rate</strong> — <code>defects ÷ (defects + clean)</code>. <em>Higher = worse;</em> the list is sorted by it, worst first.</li>
          <li><strong>🔎 Gate · Net</strong> — <code>+w</code> per confirmed catch, <code>−w</code> per false&nbsp;positive. <em>Higher = earns its keep.</em></li>
          <li><strong>Catches</strong> — confirmed real defects this gate caught.</li>
          <li><strong>False +</strong> — findings a human/author overruled (each cost the gate <code>−w</code>; the author is untouched). <em>A noisy gate.</em></li>
        </ul>
        <p class="acc__read">
          <strong>Quick read for an agent:</strong> an author with a <em>negative Net and a high Rate</em> is the
          flow shipping defects — route its work to a stricter model or add a gate. A gate with a
          <em>high Net and low False+</em> is pulling its weight; a gate with <em>False+ ≥ Catches</em> is
          crying wolf. Source: <code>findings.jsonl</code> × <code>eval-ledger.jsonl</code>, tallied deterministically (no LLM).
        </p>
      </div>
    </details>

    <p class="acc__caveat">
      First slice wired the <code>code-review</code> gate; red-team / a11y / frontend-review capture and the
      escaped-defect (revert) signal are now wired in CI (#1570). A rejected (false-positive) finding debits the gate, never the author.
    </p>
  </div>
</template>

<style scoped>
.acc__note { font-size: 12px; color: var(--ko-text-muted); margin: 0 0 14px; }
.acc__note strong { color: var(--ko-text-light); font-family: var(--mono); }
.acc__sub { display: block; margin-top: 3px; color: var(--ko-text-label); font-size: 11px; }
.acc__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.acc__ch { font-size: 11px; letter-spacing: .04em; color: var(--ko-text-light); margin-bottom: 8px; }
.acc__chsub { color: #5a6675; font-family: var(--mono); font-weight: 400; margin-left: 6px; }
.acc__table { width: 100%; border-collapse: collapse; }
th { text-align: left; color: #44515f; font-weight: 500; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; padding: 6px 8px; border-bottom: 1px solid #2a2a2a; }
td { padding: 7px 8px; border-bottom: 1px solid #1c1c1c; font-family: var(--mono); font-size: 12px; color: var(--ko-text-muted); }
.acc__name { font-family: var(--sans); color: var(--ko-text-light); }
.num { text-align: right; }
.acc__empty { color: var(--ko-text-label); text-align: center; font-family: var(--sans); }
.pill { display: inline-block; padding: 1px 7px; border-radius: 20px; font-size: 11px; font-family: var(--mono); }
.pill.pos { background: rgba(52,211,153,0.12); color: #34d399; }
.pill.neg { background: rgba(241,38,24,0.15); color: var(--ko-accent-red); }
.pill.zero { background: rgba(90,102,117,0.15); color: var(--ko-text-label); }
.acc__caveat { margin: 12px 0 0; font-size: 10.5px; color: var(--ko-text-label); }
.acc__caveat code { font-family: var(--mono); color: var(--ko-text-muted); }
.acc__guide { margin-top: 16px; border-top: 1px solid #1c1c1c; padding-top: 12px; }
.acc__guide summary { cursor: pointer; font-size: 11px; letter-spacing: .04em; color: var(--ko-accent-blue); user-select: none; }
.acc__guide summary:hover { color: #22d3ee; }
.acc__guidebody { margin-top: 10px; font-size: 11.5px; line-height: 1.55; color: var(--ko-text-muted); }
.acc__guidebody p { margin: 0 0 10px; }
.acc__guidebody strong { color: var(--ko-text-light); }
.acc__guidebody code { font-family: var(--mono); background: #0c0c0c; padding: .5px 5px; border-radius: 3px; color: var(--ko-text-muted); font-size: 10.5px; }
.acc__weights { color: var(--ko-text-label); }
.acc__cols2 { list-style: none; padding: 0; margin: 0 0 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 22px; }
.acc__cols2 li { font-size: 11px; color: var(--ko-text-muted); }
.acc__cols2 em { color: var(--ko-text-label); font-style: normal; }
.acc__read { border-left: 2px solid var(--ko-accent-blue); padding-left: 10px; color: var(--ko-text-muted); }
@media (max-width: 860px) { .acc__cols, .acc__cols2 { grid-template-columns: 1fr; } }
</style>
