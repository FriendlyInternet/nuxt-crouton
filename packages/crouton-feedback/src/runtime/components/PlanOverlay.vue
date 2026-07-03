<script setup lang="ts">
import { computed } from 'vue'
import { usePlan } from '../composables/usePlan'
import PlanSpecRow from './PlanSpecRow.vue'

/**
 * PlanOverlay — the plan modal for the Plan tool.
 *
 * Mounted once (via plan.client plugin) into the host app's context and toggled
 * by the shared `open` flag from usePlan. Renders the composed plan natively
 * with basic Nuxt UI components (UModal · UBadge · UCard · UAlert · UCollapsible)
 * over the data the module ships — NO iframe, NO custom height. UModal's default
 * `#body` slot owns the scroll + max-height, so it behaves like every other
 * modal in the app and is theme-aware. Colours come from Nuxt UI `color` props,
 * and only standard utility classes are used (a package component's arbitrary
 * `[..]` classes aren't in the app's Tailwind content scan, so they'd emit no
 * CSS).
 */
const { plan, badge, open } = usePlan()

const phases = computed(() => plan.value.phases ?? [])

type UiColor = 'primary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

// Plan status → a Nuxt UI badge colour (theme-aware, no custom CSS).
function statusColor(status: string): UiColor {
  return ({
    done: 'success',
    active: 'primary',
    next: 'info',
    blocked: 'neutral',
    later: 'neutral'
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
      <div class="space-y-5" data-crouton-ui>
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

        <!-- Phases -->
        <section
          v-for="phase in phases"
          :key="phase.id"
          class="rounded-lg border border-default p-3"
        >
          <div class="flex items-center gap-2">
            <UBadge color="neutral" variant="outline" size="sm">{{ phase.id }}</UBadge>
            <h4 class="flex-1 text-sm font-semibold">{{ phase.name }}</h4>
            <UBadge :color="statusColor(phase.status)" variant="subtle" size="sm">
              {{ phase.status }}
            </UBadge>
          </div>

          <p v-if="phase.summary" class="mt-2 text-sm text-muted">{{ phase.summary }}</p>

          <UAlert
            v-if="phase.worksNow"
            class="mt-3"
            color="primary"
            variant="soft"
            icon="i-lucide-play"
            title="Should work now"
            :description="phase.worksNow"
          />

          <p v-if="phase.gate" class="mt-2 flex items-start gap-1.5 text-xs text-muted">
            <UIcon name="i-lucide-lock" class="mt-0.5 size-3.5 shrink-0" />
            <span>{{ phase.gate }}</span>
          </p>

          <!-- Steps -->
          <ul v-if="phase.steps.length" class="mt-3 space-y-1.5">
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

          <!-- Increments -->
          <div v-if="phase.increments.length" class="mt-3 space-y-3">
            <UCard v-for="inc in phase.increments" :key="inc.id" :ui="{ body: 'p-3 sm:p-3' }">
              <div class="flex items-center gap-2">
                <UBadge color="neutral" variant="outline" size="sm">{{ inc.id }}</UBadge>
                <span class="flex-1 text-sm font-semibold">{{ inc.name }}</span>
                <UBadge :color="statusColor(inc.status)" variant="subtle" size="sm">{{ inc.status }}</UBadge>
              </div>
              <p v-if="inc.flow" class="mt-1 text-xs font-medium text-muted">
                {{ flowLabel[inc.flow] ?? inc.flow }}
              </p>
              <p v-if="inc.note" class="mt-1.5 text-xs text-muted">{{ inc.note }}</p>
              <UAlert
                v-if="inc.worksNow"
                class="mt-2"
                color="primary"
                variant="soft"
                icon="i-lucide-play"
                :description="inc.worksNow"
              />
              <div v-if="inc.specs.length" class="mt-2 space-y-1">
                <PlanSpecRow
                  v-for="spec in inc.specs"
                  :key="spec.id"
                  :spec="spec"
                  :bucket-color="bucketColor"
                />
              </div>
            </UCard>
          </div>

          <!-- Phase-level specs (no increments) -->
          <div v-if="phase.specs.length" class="mt-3 space-y-1">
            <PlanSpecRow
              v-for="spec in phase.specs"
              :key="spec.id"
              :spec="spec"
              :bucket-color="bucketColor"
            />
          </div>
        </section>
      </div>
    </template>
  </UModal>
</template>
