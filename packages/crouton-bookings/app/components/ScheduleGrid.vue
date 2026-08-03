<script setup lang="ts">
import type { SlotItem, SlotSchedule } from '../types/booking'

interface Props {
  modelValue?: SlotSchedule | string | null
  slots?: SlotItem[] | string | null
  readonly?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  slots: null,
  readonly: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: SlotSchedule]
}>()

const { t } = useT()

const days = computed(() => [
  { value: 1, label: t('bookings.schedule.days.mon') },
  { value: 2, label: t('bookings.schedule.days.tue') },
  { value: 3, label: t('bookings.schedule.days.wed') },
  { value: 4, label: t('bookings.schedule.days.thu') },
  { value: 5, label: t('bookings.schedule.days.fri') },
  { value: 6, label: t('bookings.schedule.days.sat') },
  { value: 0, label: t('bookings.schedule.days.sun') },
])

// Parse slots
const parsedSlots = computed<SlotItem[]>(() => {
  if (!props.slots) return []
  if (typeof props.slots === 'string') {
    try {
      const parsed = JSON.parse(props.slots)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return Array.isArray(props.slots) ? props.slots : []
})

// Parse schedule
const schedule = computed<SlotSchedule>(() => {
  if (!props.modelValue) return {}
  if (typeof props.modelValue === 'string') {
    try {
      const parsed = JSON.parse(props.modelValue)
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
    } catch {
      return {}
    }
  }
  return props.modelValue
})

const ALL_DAY_KEY = '_allDay'

const hasSlots = computed(() => parsedSlots.value.length > 0)
const hasSchedule = computed(() => Object.keys(schedule.value).length > 0)

function isActive(slotId: string, dayValue: number): boolean {
  const slotDays = schedule.value[slotId]
  // No entry = follows open days = all active
  if (!slotDays) return true
  return slotDays.includes(dayValue)
}

function toggle(slotId: string, dayValue: number) {
  const current = { ...schedule.value }
  const slotDays = current[slotId] ? [...current[slotId]] : days.value.map(d => d.value)

  const index = slotDays.indexOf(dayValue)
  if (index === -1) {
    slotDays.push(dayValue)
  } else {
    slotDays.splice(index, 1)
  }

  // If all days selected, remove entry (falls back to open days)
  if (slotDays.length === 7) {
    delete current[slotId]
  } else {
    current[slotId] = slotDays
  }

  emit('update:modelValue', current)
}

function getSlotLabel(slot: SlotItem): string {
  return slot.label || slot.value || slot.id
}

function clearSchedule() {
  emit('update:modelValue', {})
}
</script>

<template>
  <div class="space-y-3">
    <!-- Grid: rows = slots (or single all-day row), columns = days -->
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr>
            <th class="text-left pr-3 pb-2 text-muted font-medium text-xs">
              {{ hasSlots ? t('bookings.schedule.slotColumn') : '' }}
            </th>
            <th
              v-for="day in days"
              :key="day.value"
              class="text-center pb-2 text-muted font-medium text-xs px-1"
            >
              {{ day.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- Per-slot rows when slots exist -->
          <template v-if="hasSlots">
          <tr v-for="slot in parsedSlots" :key="slot.id">
            <td class="pr-3 py-1 text-default text-xs truncate max-w-[8rem]">
              {{ getSlotLabel(slot) }}
            </td>
            <td
              v-for="day in days"
              :key="day.value"
              class="text-center px-1 py-1"
            >
              <div
                v-if="readonly"
                class="w-6 h-6 rounded inline-flex items-center justify-center"
                :class="isActive(slot.id, day.value)
                  ? 'bg-primary/20'
                  : 'bg-muted/20'"
              >
                <span v-if="isActive(slot.id, day.value)" class="text-primary text-xs">
                  &#10003;
                </span>
              </div>
              <!-- UButton cell (not raw) so themes reach it (#1410) -->
              <UButton
                v-else
                :color="isActive(slot.id, day.value) ? 'primary' : 'neutral'"
                variant="soft"
                square
                class="w-6 h-6 p-0 justify-center rounded"
                @click="toggle(slot.id, day.value)"
              >
                <span v-if="isActive(slot.id, day.value)" class="text-primary text-xs">
                  &#10003;
                </span>
              </UButton>
            </td>
          </tr>
          </template>
          <!-- Single all-day row when no slots -->
          <tr v-else>
            <td class="pr-3 py-1 text-default text-xs">
              {{ t('bookings.schedule.allDayRow') }}
            </td>
            <td
              v-for="day in days"
              :key="day.value"
              class="text-center px-1 py-1"
            >
              <div
                v-if="readonly"
                class="w-6 h-6 rounded inline-flex items-center justify-center"
                :class="isActive(ALL_DAY_KEY, day.value)
                  ? 'bg-primary/20'
                  : 'bg-muted/20'"
              >
                <span v-if="isActive(ALL_DAY_KEY, day.value)" class="text-primary text-xs">
                  &#10003;
                </span>
              </div>
              <!-- UButton cell (not raw) so themes reach it (#1410) -->
              <UButton
                v-else
                :color="isActive(ALL_DAY_KEY, day.value) ? 'primary' : 'neutral'"
                variant="soft"
                square
                class="w-6 h-6 p-0 justify-center rounded"
                @click="toggle(ALL_DAY_KEY, day.value)"
              >
                <span v-if="isActive(ALL_DAY_KEY, day.value)" class="text-primary text-xs">
                  &#10003;
                </span>
              </UButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template v-if="!readonly">
      <p v-if="!hasSchedule" class="text-xs text-muted">
        {{ hasSlots ? t('bookings.schedule.slotScheduleHint') : t('bookings.schedule.allDaysHint') }}
      </p>
      <p v-else class="text-xs text-muted">
        {{ hasSlots
          ? t('bookings.schedule.slotScheduleActive', { count: Object.keys(schedule).length })
          : t('bookings.schedule.daysBlocked', { count: days.length - (schedule[ALL_DAY_KEY]?.length ?? days.length) })
        }}
        <UButton variant="link" size="xs" class="p-0" @click="clearSchedule">
          {{ t('bookings.schedule.resetSchedule') }}
        </UButton>
      </p>
    </template>
  </div>
</template>
