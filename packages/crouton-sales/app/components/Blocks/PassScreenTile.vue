<script setup lang="ts">
/**
 * One order on the pass board (#1762).
 *
 * Extracted from `PassScreenRender` so the board template stays readable: the
 * tile owns every per-order conditional (staff marker, incomplete warning, which
 * label the action carries), and the board owns polling and layout.
 */
export interface PassTileItem { title: string, quantity: number, remarks?: string | null }
export interface PassTileJob {
  orderId: string
  orderNumber: string
  clientName: string | null
  isPersonnel: boolean
  createdAt: string
  incomplete: boolean
  items: PassTileItem[]
}

const props = defineProps<{
  job: PassTileJob
  /** Pre-formatted age ("4m 12s") — the board owns the ticking clock. */
  age: string
}>()

defineEmits<{ handOver: [job: PassTileJob] }>()

const { t } = useT()

// Staff and incomplete both warrant the warning treatment, for different
// reasons: one is a staff order, the other is short a line.
const flagged = computed(() => props.job.isPersonnel || props.job.incomplete)

// Template complexity is suppressed, not ignored. This template scores 10/10
// (cyclomatic/cognitive); the KitchenDisplayRender board it mirrors scores
// 15/21, and this component was already split OUT of the board to bring both
// down. The remaining branches are the four states an order can be in — staff,
// incomplete, has-remarks, has-client — and collapsing them further would trade
// a readable declarative template for indirection. CRAP is inflated on top of
// that because Vue templates carry no unit coverage in this package by design.
// fallow-ignore-next-line complexity
</script>

<template>
  <div
    class="rounded-2xl bg-muted ring ring-default shadow-sm overflow-hidden flex flex-col"
    :class="flagged ? 'ring-warning/60' : ''"
  >
    <div
      class="flex items-center justify-between px-4 py-3 border-b border-default"
      :class="flagged ? 'bg-warning/10' : 'bg-elevated/60'"
    >
      <div class="flex items-baseline gap-2">
        <span class="text-2xl font-extrabold text-highlighted">#{{ job.orderNumber }}</span>
        <UBadge
          v-if="job.isPersonnel"
          color="warning"
          variant="subtle"
          size="sm"
          class="font-bold uppercase"
        >
          {{ t('sales.blocks.passScreen.ui.staff') }}
        </UBadge>
      </div>
      <span class="text-xs text-muted tabular-nums">{{ age }}</span>
    </div>

    <div class="px-4 py-3 flex-1">
      <p v-if="job.clientName" class="text-sm text-muted mb-2">{{ job.clientName }}</p>
      <ul class="space-y-1.5">
        <li v-for="(it, i) in job.items" :key="i" class="flex gap-2 text-[15px] text-default">
          <span class="font-bold text-primary tabular-nums min-w-[1.5rem]">{{ it.quantity }}×</span>
          <span class="flex-1">
            {{ it.title }}
            <span v-if="it.remarks" class="block text-xs text-warning">↳ {{ it.remarks }}</span>
          </span>
        </li>
      </ul>
    </div>

    <!--
      An item whose product has no prep location reaches no station, so no bump
      can ever arrive for it. Withholding the order would strand it at the pass
      forever, so it is offered — flagged, with a distinct label — and the runner
      decides knowingly (#1762 sign-off).
    -->
    <UAlert
      v-if="job.incomplete"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      class="mx-4 mb-3"
      :title="t('sales.blocks.passScreen.ui.incomplete')"
      :description="t('sales.blocks.passScreen.ui.incompleteHint')"
    />

    <UButton
      :color="job.incomplete ? 'warning' : 'success'"
      size="lg"
      block
      icon="i-lucide-check"
      :label="job.incomplete
        ? t('sales.blocks.passScreen.ui.handOverAnyway')
        : t('sales.blocks.passScreen.ui.handOver')"
      class="rounded-none font-bold uppercase tracking-wide"
      @click="$emit('handOver', job)"
    />
  </div>
</template>
