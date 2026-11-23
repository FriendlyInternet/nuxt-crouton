<script setup lang="ts">
// Changelog tab: search box + area filter + "Show chores" over the merged changes, grouped under
// Brussels day headers. `search`, `area` and `showChores` live on the page so they survive switching tabs.
import { groupByDay } from '~/utils/dashboard'
import type { ChangelogRow } from '~/utils/dashboard'

const props = defineProps<{ error?: string | null, pending: boolean, areas: string[], rows: ChangelogRow[] }>()
const search = defineModel<string>('search', { default: '' })
const area = defineModel<string | null>('area', { default: null })
const showChores = defineModel<boolean>('showChores', { default: false })

const groups = computed(() => groupByDay(props.rows))
const KIND_WORD: Record<ChangelogRow['kind'], string> = { new: 'New', fix: 'Fix', change: 'Change', chore: 'Chore' }

// Titles show two lines; tapping one toggles the full title.
const open = reactive(new Set<number>())
function toggle(n: number) {
  if (open.has(n)) open.delete(n)
  else open.add(n)
}
</script>

<template>
  <div class="space-y-4 py-4">
    <UInput v-model="search" icon="i-lucide-search" placeholder="Search changes" class="w-full" aria-label="Search changes" />
    <DashboardChipFilter v-if="areas.length" v-model="area" :options="areas" />
    <USwitch v-model="showChores" label="Show chores" size="sm" />

    <DashboardLoadState :error="error" :pending="pending" :empty="rows.length ? null : 'No changes yet.'" />

    <section v-for="g in groups" :key="g.day" class="space-y-1">
      <h3 class="px-1 pt-2 text-xs font-medium text-muted">
        {{ g.day }}
      </h3>
      <ul class="divide-y divide-default rounded-lg border border-default">
        <li v-for="r in g.rows" :key="r.number" class="flex items-start gap-2 p-3">
          <span class="flex size-5 shrink-0 items-center justify-center text-sm">
            <span v-if="r.kind === 'new'" aria-hidden="true">✨</span>
            <span v-else-if="r.kind === 'fix'" aria-hidden="true">🐞</span>
            <span v-else class="size-2 rounded-full bg-(--ui-border-accented)" aria-hidden="true" />
            <span class="sr-only">{{ KIND_WORD[r.kind] }}</span>
          </span>
          <div class="min-w-0 flex-1 space-y-1">
            <UBadge variant="subtle" color="neutral">{{ r.area }}</UBadge>
            <UButton
              variant="link"
              color="neutral"
              class="block w-full p-0 text-left text-sm font-normal text-default"
              :aria-expanded="open.has(r.number)"
              @click="toggle(r.number)"
            >
              <span class="block" :class="open.has(r.number) ? '' : 'line-clamp-2'">{{ r.title }}</span>
            </UButton>
          </div>
          <a :href="r.url" target="_blank" rel="noopener" class="shrink-0 text-sm text-primary">#{{ r.number }}</a>
        </li>
      </ul>
    </section>
  </div>
</template>
