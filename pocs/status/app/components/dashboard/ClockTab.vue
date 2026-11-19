<script setup lang="ts">
// Clock tab (#4216): one row per clock job — its schedule, whether the clock ran it in its last due
// slot, and when it runs next. Tapping a row opens what the job does (closed by default).
// Rows arrive sorted (red first) from the page.
import { ownerTime } from '~/utils/dashboard'
import type { ClockRow } from '~/utils/dashboard'

defineProps<{ error?: string | null, pending: boolean, rows: ClockRow[] }>()

const BADGE: Record<ClockRow['state'], { label: string, color: 'success' | 'info' | 'neutral' | 'error' }> = {
  'ok': { label: 'ran', color: 'success' },
  'running': { label: 'running', color: 'info' },
  'due': { label: 'due now', color: 'neutral' },
  'before-clock': { label: 'not on the clock yet', color: 'neutral' },
  'missed': { label: 'missed', color: 'error' },
  'failed': { label: 'failed', color: 'error' },
  'unknown': { label: '?', color: 'neutral' }
}
const name = (workflow: string) => workflow.replace(/\.ya?ml$/, '')

const open = ref<Record<string, boolean>>({})
const toggle = (workflow: string) => { open.value = { ...open.value, [workflow]: !open.value[workflow] } }
</script>

<template>
  <div class="space-y-4 py-4">
    <DashboardLoadState :error="error" :pending="pending" :empty="rows.length ? null : 'No clock jobs.'" />

    <ul v-if="rows.length" class="divide-y divide-default rounded-lg border border-default">
      <li v-for="r in rows" :key="r.workflow">
        <!-- The button stretches over the whole row (after:inset-0); the run link sits above it. -->
        <div class="relative flex flex-wrap items-start justify-between gap-x-3 gap-y-1 p-3">
          <button
            type="button"
            class="min-w-0 text-left after:absolute after:inset-0"
            :aria-expanded="!!open[r.workflow]"
            @click="toggle(r.workflow)"
          >
            <span class="block text-sm font-medium break-words">{{ name(r.workflow) }}</span>
            <span class="block text-xs text-muted">{{ r.schedule }}</span>
            <span v-if="r.error" class="block text-xs text-error break-words">{{ r.error }}</span>
          </button>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <UBadge variant="subtle" :color="BADGE[r.state].color">{{ BADGE[r.state].label }}</UBadge>
            <span>
              last:
              <a v-if="r.lastRun?.url" :href="r.lastRun.url" target="_blank" rel="noopener" class="relative z-10 text-primary">{{ ownerTime(r.lastRun.createdAt) }}</a>
              <template v-else-if="r.lastRun">{{ ownerTime(r.lastRun.createdAt) }}</template>
              <template v-else>{{ ownerTime(r.lastDue) }}</template>
              · next: {{ ownerTime(r.nextDue) }}
            </span>
          </div>
        </div>
        <UCollapsible :open="!!open[r.workflow]">
          <template #content>
            <p class="px-3 pb-3 text-xs text-muted">{{ r.about }}</p>
          </template>
        </UCollapsible>
      </li>
    </ul>
  </div>
</template>
