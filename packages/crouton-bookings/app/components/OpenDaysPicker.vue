<script setup lang="ts">
interface Props {
  modelValue?: number[] | string | null
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: number[]]
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

// Parse modelValue (handles string from DB)
const selectedDays = computed<number[]>(() => {
  if (!props.modelValue) return []
  if (Array.isArray(props.modelValue)) return props.modelValue
  if (typeof props.modelValue === 'string') {
    try {
      const parsed = JSON.parse(props.modelValue)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
})

const allOpen = computed(() => selectedDays.value.length === 0)

function toggleDay(dayValue: number) {
  const current = [...selectedDays.value]
  const index = current.indexOf(dayValue)
  if (index === -1) {
    current.push(dayValue)
  } else {
    current.splice(index, 1)
  }
  emit('update:modelValue', current)
}

function isDaySelected(dayValue: number): boolean {
  // If empty (all open), all are selected
  if (allOpen.value) return true
  return selectedDays.value.includes(dayValue)
}

function clearAll() {
  emit('update:modelValue', [])
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex gap-1.5 flex-wrap">
      <UButton
        v-for="day in days"
        :key="day.value"
        size="sm"
        :variant="isDaySelected(day.value) && !allOpen ? 'soft' : allOpen ? 'outline' : 'ghost'"
        :color="isDaySelected(day.value) && !allOpen ? 'primary' : 'neutral'"
        class="min-w-[3rem]"
        @click="toggleDay(day.value)"
      >
        {{ day.label }}
      </UButton>
    </div>
    <p v-if="allOpen" class="text-xs text-muted">
      {{ t('bookings.schedule.openDaysHint') }}
    </p>
    <p v-else class="text-xs text-muted">
      {{ t('bookings.schedule.openDaysCount', { count: selectedDays.length }) }}
      <UButton variant="link" size="xs" class="p-0" @click="clearAll">
        {{ t('bookings.schedule.resetAllDays') }}
      </UButton>
    </p>
  </div>
</template>
