<script setup lang="ts">
import type { BlockedDateItem, SlotItem } from '../types/booking'
import { parseLocationSlots } from '../composables/useBookingSlots'

interface Props {
  modelValue: BlockedDateItem
  slots?: SlotItem[] | string | null
  inventoryMode?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  slots: null,
  inventoryMode: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: BlockedDateItem]
}>()

const { t } = useT()

// Convert YYYY-MM-DD string to Date
function toDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

// Convert Date to YYYY-MM-DD string
function toDateString(date: Date | null): string {
  if (!date) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Format date for display
function formatDate(dateStr: string | undefined): string {
  const d = toDate(dateStr)
  if (!d) return ''
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

// Display label for the date range button
const displayLabel = computed(() => {
  const start = props.modelValue.startDate
  const end = props.modelValue.endDate
  if (start && end) {
    if (start === end) return formatDate(start)
    return `${formatDate(start)} – ${formatDate(end)}`
  }
  if (start) return formatDate(start)
  return null
})

// Calendar range dates (CroutonCalendar uses Date objects)
const startDate = computed(() => toDate(props.modelValue.startDate))
const endDate = computed(() => toDate(props.modelValue.endDate))

function onUpdateStartDate(date: Date | null) {
  emit('update:modelValue', {
    ...props.modelValue,
    startDate: toDateString(date),
  })
}

function onUpdateEndDate(date: Date | null) {
  emit('update:modelValue', {
    ...props.modelValue,
    endDate: toDateString(date),
  })
}

function update(field: keyof BlockedDateItem, value: unknown) {
  emit('update:modelValue', {
    ...props.modelValue,
    [field]: value,
  })
}

// Parse slots
const parsedSlots = computed<SlotItem[]>(() => parseLocationSlots({ slots: props.slots }))

const showSlotRestriction = ref(
  (props.modelValue.blockedSlots?.length ?? 0) > 0,
)

function toggleSlotRestriction() {
  showSlotRestriction.value = !showSlotRestriction.value
  if (!showSlotRestriction.value) {
    update('blockedSlots', [])
  }
}

function toggleSlot(slotId: string) {
  const current = [...(props.modelValue.blockedSlots || [])]
  const index = current.indexOf(slotId)
  if (index === -1) {
    current.push(slotId)
  } else {
    current.splice(index, 1)
  }
  update('blockedSlots', current)
}

function isSlotBlocked(slotId: string): boolean {
  return props.modelValue.blockedSlots?.includes(slotId) ?? false
}

function getSlotLabel(slot: SlotItem): string {
  return slot.label || slot.value || slot.id
}
</script>

<template>
  <div class="space-y-3">
    <!-- Date range picker + Reason -->
    <div class="flex gap-3 items-start flex-wrap">
      <UFormField :label="t('bookings.schedule.dateRange')" class="flex-1 min-w-[200px]">
        <UPopover>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-calendar"
            class="w-full justify-start"
          >
            <span v-if="displayLabel">{{ displayLabel }}</span>
            <span v-else class="text-muted">{{ t('bookings.schedule.pickDateRange') }}</span>
          </UButton>

          <template #content>
            <CroutonCalendar
              range
              :start-date="startDate"
              :end-date="endDate"
              :number-of-months="2"
              class="p-2"
              @update:start-date="onUpdateStartDate"
              @update:end-date="onUpdateEndDate"
            />
          </template>
        </UPopover>
      </UFormField>

      <UFormField :label="t('bookings.schedule.reason')" class="flex-1 min-w-[140px]">
        <UInput
          :model-value="modelValue.reason || ''"
          :placeholder="t('bookings.schedule.reasonPlaceholder')"
          @update:model-value="update('reason', $event)"
        />
      </UFormField>
    </div>

    <!-- Slot restriction toggle (hidden in inventory mode) -->
    <div v-if="!inventoryMode && parsedSlots.length > 0">
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        @click="toggleSlotRestriction"
      >
        {{ showSlotRestriction ? t('bookings.schedule.blockEntireDay') : t('bookings.schedule.blockSpecificSlots') }}
      </UButton>

      <!-- Slot selector -->
      <div v-if="showSlotRestriction" class="flex gap-1.5 flex-wrap mt-2">
        <UButton
          v-for="slot in parsedSlots"
          :key="slot.id"
          size="xs"
          :variant="isSlotBlocked(slot.id) ? 'soft' : 'ghost'"
          :color="isSlotBlocked(slot.id) ? 'error' : 'neutral'"
          @click="toggleSlot(slot.id)"
        >
          {{ getSlotLabel(slot) }}
        </UButton>
      </div>
      <p v-if="showSlotRestriction && (modelValue.blockedSlots?.length ?? 0) === 0" class="text-xs text-muted mt-1">
        {{ t('bookings.schedule.selectSlotsToBlock') }}
      </p>
    </div>
  </div>
</template>
