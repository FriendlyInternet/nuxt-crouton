<script setup lang="ts">
/**
 * The body of one flow's setup guide (#1364): a numbered checklist with
 * copyable value chips. The verify step carries the flow's live heartbeat
 * dot (class passed in by the picker) — setup is confirmed by the same
 * signal as the liveness readout. Content is fully translated upstream;
 * it must mirror print-server/README.md (see the sync note there).
 */
import type { TransportSetupGuide } from '../types/transport-setup'

defineProps<{
  guide: TransportSetupGuide
  /** Live dot class for the guide's flow (from the picker's heartbeat state). */
  verifyDotClass: string
  copyLabel?: string
  copiedLabel?: string
}>()
</script>

<template>
  <div class="space-y-3 rounded-lg bg-elevated/60 p-3">
    <p v-if="guide.intro" class="text-sm text-muted">{{ guide.intro }}</p>

    <ol class="space-y-2.5">
      <li
        v-for="(step, i) in guide.steps"
        :key="i"
        class="flex gap-2.5 text-sm"
      >
        <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accented text-[11px] font-semibold text-muted">
          {{ i + 1 }}
        </span>
        <div class="min-w-0 flex-1 space-y-1.5">
          <p class="leading-5">
            <span
              v-if="step.verify"
              class="me-1.5 inline-block size-2 rounded-full transition-colors"
              :class="verifyDotClass"
            />{{ step.text }}
          </p>
          <CroutonPrintingTransportSetupCopyChip
            :value="step.value"
            :value-label="step.valueLabel"
            :copy-label="copyLabel"
            :copied-label="copiedLabel"
          />
        </div>
      </li>
    </ol>
  </div>
</template>
