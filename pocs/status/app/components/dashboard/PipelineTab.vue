<script setup lang="ts">
// Pipeline tab (#4349): every ticket the pipeline is working on, one column per stage, read-only
// (cards can't be dragged; tapping one opens it on GitHub). The page fetches the rows
// (GET /api/status/board) and re-reads them every 30 s while visible; `updatedAt` is that read's time.
// On a phone the columns scroll sideways.
import type { Component } from 'vue'
import { shortAge } from '~/utils/dashboard'
import type { BoardRow } from '~/utils/dashboard'

const props = defineProps<{ error?: string | null, pending: boolean, rows: BoardRow[], updatedAt: number | null }>()

const COLUMNS = [
  { value: 'queued', label: 'Queued', icon: 'i-lucide-hourglass' },
  { value: 'working', label: 'Working', icon: 'i-lucide-hammer' },
  { value: 'review', label: 'In review', icon: 'i-lucide-eye' },
  { value: 'you', label: 'Waits on you', icon: 'i-lucide-hand' },
  { value: 'test', label: 'To test', icon: 'i-lucide-flask-conical' },
  { value: 'done', label: 'Done today', icon: 'i-lucide-check' }
]

const PipelineCard = resolveComponent('DashboardPipelineCard') as Component

// Ticks every 10 s so "updated N s ago" and the card ages move between re-reads.
const now = ref(Date.now())
useIntervalFn(() => { now.value = Date.now() }, 10_000)

const cards = computed(() => props.rows.map(r => ({ ...r, age: shortAge(r.since, now.value) })))
const updated = computed(() => (props.updatedAt ? `${Math.max(0, Math.round((now.value - props.updatedAt) / 1000))} s ago` : '—'))
</script>

<template>
  <div class="space-y-3 py-4">
    <DashboardLoadState :error="error" :pending="pending && !rows.length" :empty="pending || rows.length || error ? null : 'Nothing in the pipeline right now.'" />
    <p class="text-xs text-muted">
      Live · updated {{ updated }} · {{ rows.length }} {{ rows.length === 1 ? 'ticket' : 'tickets' }}
    </p>
    <div class="overflow-x-auto">
      <CroutonKanban
        :rows="cards"
        collection="pipelineItems"
        group-field="column"
        order-field="order"
        :columns="COLUMNS"
        :card-component="PipelineCard"
        readonly
      />
    </div>
  </div>
</template>
