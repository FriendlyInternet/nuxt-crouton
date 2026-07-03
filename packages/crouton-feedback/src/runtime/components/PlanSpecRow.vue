<script setup lang="ts">
import type { ComposedSpec } from '../tools/plan-data'

/**
 * PlanSpecRow — one spec-ledger entry in the Plan overlay, as a Nuxt UI
 * `UCollapsible`: the trigger row shows the graduation bucket + behaviour (+ a
 * ✓ when signed off), and expands to the expect / hook / how-to-test detail.
 * Uses only standard utilities + Nuxt UI components (no arbitrary Tailwind
 * classes — those don't get generated for a package component).
 */
type UiColor = 'primary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

defineProps<{
  spec: ComposedSpec
  bucketColor: (bucket: string) => UiColor
}>()
</script>

<template>
  <UCollapsible>
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-elevated"
    >
      <UBadge :color="bucketColor(spec.bucket)" variant="subtle" size="sm">{{ spec.bucket }}</UBadge>
      <span class="flex-1 text-sm">{{ spec.behaviour }}</span>
      <UBadge v-if="spec.signedOff" color="success" variant="soft" size="sm" icon="i-lucide-check" />
      <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted" />
    </button>

    <template #content>
      <div class="space-y-1.5 px-2 pb-2 pt-1 text-xs text-muted">
        <p v-if="spec.expect">
          <span class="font-medium text-default">Expect: </span>{{ spec.expect }}
        </p>
        <p v-if="spec.hook">
          <span class="font-medium text-default">Hook: </span><code>{{ spec.hook }}</code>
        </p>
        <p v-if="spec.howToTest">
          <span class="font-medium text-default">🧪 How to test: </span>{{ spec.howToTest }}
        </p>
        <p v-if="spec.signedOff" class="text-success">✓ signed off: {{ spec.signedOff }}</p>
      </div>
    </template>
  </UCollapsible>
</template>
