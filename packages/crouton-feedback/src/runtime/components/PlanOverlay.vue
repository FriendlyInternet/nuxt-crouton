<script setup lang="ts">
import { computed } from 'vue'
import { usePlan } from '../composables/usePlan'
import { useSpecWalk } from '../composables/useSpecWalk'
import PlanSpecRow from './PlanSpecRow.vue'

/**
 * PlanOverlay — the plan modal for the Plan tool (#1155), fused with the Spec
 * walk (#1180).
 *
 * Renders the composed plan natively with Nuxt UI (UModal · UBadge · UAlert ·
 * UCollapsible) — no iframe, no custom height, standard utilities only (a package
 * SFC's arbitrary `[..]` classes aren't in the app's Tailwind scan → no CSS).
 *
 * Readable on mobile: phases + increments are **collapsible**, default-open only
 * the ACTIVE one, so the overlay opens as a scannable outline instead of a wall.
 * And it's one flow — the plan is the map; a behaviour's **Walk & sign off**
 * (and each "should work now" callout) drops straight into the Spec walk on that
 * entry (`jumpTo`), closing the plan so the non-blocking walk lets you perform
 * the gesture. Each behaviour row reflects its live walk verdict (✅ / ⚠️ / ✓).
 */
const { plan, badge, open } = usePlan()
const { open: walkOpen, jumpTo, walkScoped, walkAll, isWalkable, verdictOf, markedTotal, total } = useSpecWalk()

const phases = computed(() => plan.value.phases ?? [])

type UiColor = 'primary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

// Plan status → a Nuxt UI badge colour (theme-aware, no custom CSS). `active` is
// deliberately DISTINCT from `done` (this app's `primary` reads as the same green
// as `success`, so active ≠ done needs a different hue) — active = info (blue).
function statusColor(status: string): UiColor {
  return ({
    done: 'success', // green — finished
    active: 'info', // blue — the one you're on (distinct from done)
    next: 'warning', // amber — on deck
    blocked: 'error', // red — stuck
    later: 'neutral' // grey — parked
  } as Record<string, UiColor>)[status] ?? 'neutral'
}

// Graduation bucket → a badge colour: Preserve=keep, Replace=swap, Add=new.
function bucketColor(bucket: string): UiColor {
  return ({
    Preserve: 'success',
    Replace: 'warning',
    Add: 'info',
    Proposed: 'neutral'
  } as Record<string, UiColor>)[bucket] ?? 'neutral'
}

const flowLabel: Record<string, string> = {
  sequential: 'Sequential',
  staggered: 'Staggered — verify each as it lands',
  parallel: 'Parallel — independent'
}

const ghUrl = (n: number | null | undefined, kind: 'issues' | 'pull') =>
  n ? `https://github.com/FriendlyInternet/nuxt-crouton/${kind}/${n}` : undefined

// The LIVE (walkable) behaviour ids under a set of specs — the scope the
// section "Walk & sign off" buttons pass.
const walkableIds = (specs: { id: string }[]): string[] =>
  specs.filter(s => isWalkable(s.id)).map(s => s.id)

// Leave the plan, enter the Spec walk — three scopes:
//  · ALL      — the full regression walk (the top "Check & sign off" bar)
//  · SECTION  — just an increment's / phase's behaviours ("what we just did")
//  · ONE      — just a single behaviour ("does this one work?")
function startWalkAll() { open.value = false; walkAll() }
function startWalkScope(ids: string[]) { open.value = false; walkScoped(ids) }
function startWalkOne(id: string) { open.value = false; if (!jumpTo(id)) walkOpen.value = true }
</script>

<template>
  <UModal
    v-model:open="open"
    :title="plan.title || 'Plan'"
    :description="badge ? `You are on ${badge}` : undefined"
    :ui="{ content: 'sm:max-w-2xl' }"
    data-crouton-ui
  >
    <template #body>
      <div class="space-y-4" data-crouton-ui>
        <p v-if="plan.intro" class="text-sm text-muted">{{ plan.intro }}</p>

        <div v-if="plan.epic || plan.pr" class="flex flex-wrap items-center gap-2">
          <UButton
            v-if="plan.epic"
            :to="ghUrl(plan.epic, 'issues')"
            target="_blank"
            color="neutral"
            variant="subtle"
            size="xs"
            icon="i-lucide-target"
          >Epic #{{ plan.epic }}</UButton>
          <UButton
            v-if="plan.pr"
            :to="ghUrl(plan.pr, 'pull')"
            target="_blank"
            color="neutral"
            variant="subtle"
            size="xs"
            icon="i-lucide-git-pull-request"
          >PR #{{ plan.pr }}</UButton>
        </div>

        <!-- Check & sign off — where we are; walk EVERYTHING (the full regression). -->
        <div
          v-if="total"
          class="flex items-center gap-3 rounded-lg border border-default p-3"
        >
          <UIcon name="i-lucide-list-checks" class="size-5 shrink-0 text-primary" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">Check &amp; sign off</p>
            <p class="text-xs text-muted">{{ markedTotal }} of {{ total }} behaviours marked</p>
          </div>
          <UButton
            size="xs"
            color="primary"
            variant="soft"
            icon="i-lucide-play"
            label="Walk all"
            @click="startWalkAll()"
          />
        </div>

        <!-- Phases — collapsible; the ACTIVE one opens by default. -->
        <UCollapsible
          v-for="phase in phases"
          :key="phase.id"
          :default-open="phase.status === 'active'"
          class="rounded-lg border border-default"
        >
          <button
            type="button"
            class="flex w-full items-center gap-2 p-3 text-left hover:bg-elevated"
          >
            <UBadge color="neutral" variant="outline" size="sm">{{ phase.id }}</UBadge>
            <h4 class="flex-1 text-sm font-semibold">{{ phase.name }}</h4>
            <UBadge :color="statusColor(phase.status)" variant="subtle" size="sm">
              {{ phase.status }}
            </UBadge>
            <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted" />
          </button>

          <template #content>
            <div class="space-y-3 px-3 pb-3">
              <p v-if="phase.summary" class="text-sm text-muted">{{ phase.summary }}</p>

              <div v-if="phase.worksNow" class="space-y-1.5">
                <UAlert
                  color="primary"
                  variant="soft"
                  icon="i-lucide-play"
                  title="Should work now"
                  :description="phase.worksNow"
                />
                <UButton
                  v-if="walkableIds([...phase.specs, ...phase.increments.flatMap(i => i.specs)]).length"
                  size="xs"
                  color="primary"
                  variant="ghost"
                  icon="i-lucide-list-checks"
                  label="Walk this section"
                  @click="startWalkScope(walkableIds([...phase.specs, ...phase.increments.flatMap(i => i.specs)]))"
                />
              </div>

              <p v-if="phase.gate" class="flex items-start gap-1.5 text-xs text-muted">
                <UIcon name="i-lucide-lock" class="mt-0.5 size-3.5 shrink-0" />
                <span>{{ phase.gate }}</span>
              </p>

              <ul v-if="phase.steps.length" class="space-y-1.5">
                <li
                  v-for="s in phase.steps"
                  :key="s.name"
                  class="flex flex-wrap items-baseline gap-2 text-sm"
                >
                  <UBadge :color="statusColor(s.status)" variant="subtle" size="sm">{{ s.status }}</UBadge>
                  <span class="font-medium">{{ s.name }}</span>
                  <span v-if="s.test" class="text-xs text-muted">🧪 {{ s.test }}</span>
                </li>
              </ul>

              <!-- Increments — also collapsible; active opens by default. -->
              <UCollapsible
                v-for="inc in phase.increments"
                :key="inc.id"
                :default-open="inc.status === 'active'"
                class="rounded-lg border border-default"
              >
                <button
                  type="button"
                  class="flex w-full items-center gap-2 p-2.5 text-left hover:bg-elevated"
                >
                  <UBadge color="neutral" variant="outline" size="sm">{{ inc.id }}</UBadge>
                  <span class="flex-1 text-sm font-semibold">{{ inc.name }}</span>
                  <UBadge :color="statusColor(inc.status)" variant="subtle" size="sm">{{ inc.status }}</UBadge>
                  <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted" />
                </button>

                <template #content>
                  <div class="space-y-2 px-2.5 pb-2.5">
                    <p v-if="inc.flow" class="text-xs font-medium text-muted">
                      {{ flowLabel[inc.flow] ?? inc.flow }}
                    </p>
                    <p v-if="inc.note" class="text-xs text-muted">{{ inc.note }}</p>
                    <div v-if="inc.worksNow" class="space-y-1.5">
                      <UAlert
                        color="primary"
                        variant="soft"
                        icon="i-lucide-play"
                        :description="inc.worksNow"
                      />
                      <UButton
                        v-if="walkableIds(inc.specs).length"
                        size="xs"
                        color="primary"
                        variant="ghost"
                        icon="i-lucide-list-checks"
                        label="Walk this section"
                        @click="startWalkScope(walkableIds(inc.specs))"
                      />
                    </div>
                    <div v-if="inc.specs.length" class="space-y-1">
                      <PlanSpecRow
                        v-for="spec in inc.specs"
                        :key="spec.id"
                        :spec="spec"
                        :bucket-color="bucketColor"
                        :verdict="verdictOf(spec.id)"
                        :walkable="isWalkable(spec.id)"
                        @walk="startWalkOne"
                      />
                    </div>
                  </div>
                </template>
              </UCollapsible>

              <!-- Phase-level specs (no increments) -->
              <div v-if="phase.specs.length" class="space-y-1">
                <PlanSpecRow
                  v-for="spec in phase.specs"
                  :key="spec.id"
                  :spec="spec"
                  :bucket-color="bucketColor"
                  :verdict="verdictOf(spec.id)"
                  :walkable="isWalkable(spec.id)"
                  @walk="startWalkOne"
                />
              </div>
            </div>
          </template>
        </UCollapsible>
      </div>
    </template>
  </UModal>
</template>
