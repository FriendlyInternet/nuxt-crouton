<script setup lang="ts">
/**
 * One kitchen-display ticket — an `(order × location)` card (#61). Extracted
 * from `KitchenDisplayRender` so the board template stays readable (#4480).
 *
 * Two-step tap-to-arm-then-confirm (#2115): tapping a resting card emits `arm`;
 * the armed card shows a full-card confirm overlay that emits `confirm`.
 */
interface KdsItem { title: string, quantity: number, remarks?: string | null }
interface KdsJob {
  id: string
  orderNumber: string
  clientName: string | null
  isPersonnel: boolean
  items: KdsItem[]
}

const props = defineProps<{
  job: KdsJob
  /** Relative age label, e.g. "1m 20s". */
  age: string
  armed: boolean
  confirmed: boolean
}>()

const emit = defineEmits<{ arm: [], confirm: [] }>()

const { t } = useT()

function onTap() {
  if (!props.armed) emit('arm')
}
</script>

<template>
  <div
    class="relative rounded-2xl bg-muted ring ring-default shadow-sm overflow-hidden flex flex-col"
    :class="job.isPersonnel ? 'ring-warning/60' : ''"
    @click="onTap"
  >
    <div
      class="flex items-center justify-between px-4 py-3 border-b border-default"
      :class="job.isPersonnel ? 'bg-warning/10' : 'bg-elevated/60'"
    >
      <div class="flex items-baseline gap-2">
        <span class="text-2xl font-extrabold text-highlighted">#{{ job.orderNumber }}</span>
        <UBadge v-if="job.isPersonnel" color="warning" variant="subtle" size="sm" class="font-bold uppercase">{{ t('sales.blocks.kitchenDisplay.ui.staff') }}</UBadge>
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

    <UButton
      color="neutral"
      variant="soft"
      size="lg"
      block
      icon="i-lucide-check"
      :label="t('sales.blocks.kitchenDisplay.ui.bump')"
      class="rounded-none font-bold uppercase tracking-wide"
      @click.stop="onTap"
    />

    <!-- Armed state: full-card confirm overlay (#2115) -->
    <Transition name="confirm-overlay">
      <!-- eslint-disable-next-line vue/no-restricted-html-elements -- moved unchanged from KitchenDisplayRender.vue; full-card tap target, a UButton would change the tile's look -->
      <button
        v-if="armed"
        type="button"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-success text-inverted font-bold uppercase tracking-wide cursor-pointer"
        @click.stop="emit('confirm')"
      >
        <UIcon :name="confirmed ? 'i-lucide-check-circle-2' : 'i-lucide-check'" class="size-10" />
        <span class="text-lg">{{ t('sales.blocks.kitchenDisplay.ui.bump') }}</span>
        <span class="text-xs font-normal normal-case opacity-80">{{ t('sales.blocks.kitchenDisplay.ui.tapToConfirm') }}</span>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.confirm-overlay-enter-active, .confirm-overlay-leave-active { transition: opacity .15s ease; }
.confirm-overlay-enter-from, .confirm-overlay-leave-to { opacity: 0; }
</style>
