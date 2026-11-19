<script setup lang="ts">
// Clock tab (#4216): one row per clock job — its schedule, whether the clock ran it in its last due
// slot, and when it runs next. Rows arrive sorted (red first) from the page.
import { ownerTime } from '~/utils/dashboard'
import type { ClockRow } from '~/utils/dashboard'

defineProps<{ error?: string | null, pending: boolean, rows: ClockRow[] }>()

const BADGE: Record<ClockRow['state'], { label: string, color: 'success' | 'info' | 'neutral' | 'error' }> = {
  ok: { label: 'ran', color: 'success' },
  running: { label: 'running', color: 'info' },
  due: { label: 'due now', color: 'neutral' },
  missed: { label: 'missed', color: 'error' },
  failed: { label: 'failed', color: 'error' },
  unknown: { label: '?', color: 'neutral' }
}
const name = (workflow: string) => workflow.replace(/\.ya?ml$/, '')
</script>

<template>
  <div class="space-y-4 py-4">
    <DashboardLoadState :error="error" :pending="pending" :empty="rows.length ? null : 'No clock jobs.'" />

    <ul v-if="rows.length" class="divide-y divide-default rounded-lg border border-default">
      <li v-for="r in rows" :key="r.workflow" class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 p-3">
        <div class="min-w-0">
          <p class="text-sm font-medium break-words">{{ name(r.workflow) }}</p>
          <p class="text-xs text-muted">{{ r.schedule }}</p>
          <p v-if="r.error" class="text-xs text-error break-words">{{ r.error }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <UBadge variant="subtle" :color="BADGE[r.state].color">{{ BADGE[r.state].label }}</UBadge>
          <span>
            last:
            <a v-if="r.lastRun" :href="r.lastRun.url" target="_blank" rel="noopener" class="text-primary">{{ ownerTime(r.lastRun.createdAt) }}</a>
            <template v-else>{{ ownerTime(r.lastDue) }}</template>
            · next: {{ ownerTime(r.nextDue) }}
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>
