<script setup lang="ts">
// Decisions tab: open questions first, then the decisions log (tap a row for why / not chosen).
import type { Decision, OpenQuestion } from '~/utils/status-types'

const { data: decisionsRes, status: decisionsStatus } = useFetch<{ data: { decisions: Decision[], openQuestions: OpenQuestion[] } | null, error: string | null }>('/api/status/decisions', { lazy: true })
const decisions = computed(() => decisionsRes.value?.data?.decisions ?? [])
const openQuestions = computed(() => decisionsRes.value?.data?.openQuestions ?? [])
const pending = computed(() => decisionsStatus.value === 'pending')
const isEmpty = computed(() => !pending.value && !decisions.value.length && !openQuestions.value.length)
const expanded = ref<string | null>(null)
const rowKey = (d: Decision, idx: number) => `${d.epic}-${idx}`
const toggle = (key: string) => { expanded.value = expanded.value === key ? null : key }
</script>

<template>
  <div class="space-y-5 py-4">
    <UAlert v-if="decisionsRes?.error" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="decisionsRes.error" />
    <p v-if="pending" class="text-muted">Loading…</p>
    <StatusOpenQuestions v-if="openQuestions.length" :questions="openQuestions" />
    <p v-if="isEmpty" class="text-muted">No decisions yet.</p>
    <ul v-if="decisions.length" class="divide-y divide-default rounded-lg border border-default">
      <StatusDecisionRow
        v-for="(d, idx) in decisions"
        :key="rowKey(d, idx)"
        :decision="d"
        :open="expanded === rowKey(d, idx)"
        @toggle="toggle(rowKey(d, idx))"
      />
    </ul>
  </div>
</template>
