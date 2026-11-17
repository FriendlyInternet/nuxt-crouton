<script setup lang="ts">
// Decisions tab: open questions waiting on the owner, then the decision log (one row open at a time).
// `expanded` lives on the page so the open row survives switching tabs.
import type { Decision, OpenQuestion } from '~/utils/dashboard'

const props = defineProps<{ error?: string | null, pending: boolean, decisions: Decision[], openQuestions: OpenQuestion[] }>()
const expanded = defineModel<string | null>('expanded', { default: null })
const rowKey = (d: Decision, idx: number) => `${d.epic}-${idx}`
const toggle = (key: string) => { expanded.value = expanded.value === key ? null : key }
const empty = computed(() => !props.pending && !props.decisions.length && !props.openQuestions.length)
</script>

<template>
  <div class="space-y-5 py-4">
    <DashboardLoadState :error="error" :pending="pending" />

    <UCard v-if="openQuestions.length" class="ring-warning/50">
      <template #header>
        <h2 class="font-semibold">Waiting on you ({{ openQuestions.length }})</h2>
      </template>
      <ul class="space-y-2">
        <li v-for="q in openQuestions" :key="q.number" class="text-sm">
          <a :href="q.url" target="_blank" rel="noopener" class="text-primary">#{{ q.number }}</a>
          {{ q.title }}
        </li>
      </ul>
    </UCard>

    <p v-if="empty" class="text-muted">No decisions yet.</p>

    <ul v-if="decisions.length" class="divide-y divide-default rounded-lg border border-default">
      <DashboardDecisionRow
        v-for="(d, idx) in decisions"
        :key="rowKey(d, idx)"
        :decision="d"
        :open="expanded === rowKey(d, idx)"
        @toggle="toggle(rowKey(d, idx))"
      />
    </ul>
  </div>
</template>
