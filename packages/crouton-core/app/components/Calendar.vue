<script setup lang="ts">
import { CalendarDate, fromDate, toCalendarDate, getLocalTimeZone, type DateValue } from '@internationalized/date'

// DateRange interface - defined in Nuxt UI but not exported from @internationalized/date
interface DateRange {
  start: DateValue | undefined
  end: DateValue | undefined
}

interface Props {
  date?: Date | number | null // Date or timestamp for single date
  range?: boolean // Enable range selection
  startDate?: Date | number | null // Start date or timestamp for range
  endDate?: Date | number | null // End date or timestamp for range
  color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
  variant?: 'solid' | 'outline' | 'soft' | 'subtle'
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  disabled?: boolean
  minDate?: Date | number | null // Min selectable date or timestamp
  maxDate?: Date | number | null // Max selectable date or timestamp
  monthControls?: boolean // Show month controls
  yearControls?: boolean // Show year controls
  numberOfMonths?: number // Number of months to display (in a row)
  year?: boolean | number // Enable year grid mode (12 months). Pass number for specific year.
  isDateDisabled?: (date: Date) => boolean // Function to disable specific dates (uses JS Date)
  ui?: Record<string, unknown> // Passthrough UI customization to UCalendar
  picker?: boolean // Wrap calendar in a popover with a date button (compact mode)
  placeholder?: string // Placeholder text for picker button when no date selected
}

const props = withDefaults(defineProps<Props>(), {
  date: null,
  range: false,
  startDate: null,
  endDate: null,
  color: 'primary',
  variant: 'solid',
  size: 'md',
  disabled: false,
  minDate: null,
  maxDate: null,
  monthControls: true,
  yearControls: true,
  numberOfMonths: undefined,
  year: undefined,
  picker: false,
  placeholder: undefined
})

const { t } = useT()

const emit = defineEmits<{
  'update:date': [value: Date | null]
  'update:startDate': [value: Date | null]
  'update:endDate': [value: Date | null]
}>()

// Helper: Convert Date or timestamp to CalendarDate
function toCalendarDateValue(value: Date | number | null | undefined): DateValue | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  // Convert Date -> ZonedDateTime -> CalendarDate
  const zonedDateTime = fromDate(date, getLocalTimeZone())
  return toCalendarDate(zonedDateTime)
}

// Helper: Convert CalendarDate to Date
function calendarDateToDate(date: DateValue | null | undefined): Date | null {
  if (!date) return null
  return date.toDate(getLocalTimeZone())
}

// Single date mode
const internalDate = computed({
  get: () => toCalendarDateValue(props.date),
  set: (value: DateValue | null | undefined) => {
    emit('update:date', calendarDateToDate(value))
  }
})

// Range mode
const internalRange = computed({
  get: (): DateRange | undefined => {
    const start = toCalendarDateValue(props.startDate)
    const end = toCalendarDateValue(props.endDate)

    if (!start && !end) return undefined

    return {
      start: start || undefined,
      end: end || undefined
    }
  },
  set: (value: DateRange | null | undefined) => {
    if (!value) {
      emit('update:startDate', null)
      emit('update:endDate', null)
      return
    }

    emit('update:startDate', calendarDateToDate(value.start))
    emit('update:endDate', calendarDateToDate(value.end))
  }
})

// Min/Max constraints
const minCalendarDate = computed(() => toCalendarDateValue(props.minDate))
const maxCalendarDate = computed(() => toCalendarDateValue(props.maxDate))

// Determine if we're in year grid mode
const isYearMode = computed(() => props.year !== undefined && props.year !== false)

// Get the year to display (from prop or current year)
const displayYear = computed(() => {
  if (typeof props.year === 'number') return props.year
  return new Date().getFullYear()
})

// Create placeholder dates for each month (year grid mode)
const months = computed(() =>
  Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    placeholder: new CalendarDate(displayYear.value, i + 1, 1)
  }))
)

// Computed number of months (default to 2 for ranges, 1 for single)
const displayMonths = computed(() => {
  if (props.numberOfMonths) return props.numberOfMonths
  return props.range ? 2 : 1
})

// Wrapper for isDateDisabled that converts DateValue to Date
function internalIsDateDisabled(dateValue: DateValue): boolean {
  if (!props.isDateDisabled) return false
  const date = calendarDateToDate(dateValue)
  if (!date) return false
  return props.isDateDisabled(date)
}

// Check if we have a day slot
const slots = useSlots()
const hasDaySlot = computed(() => !!slots.day)

// Picker mode: formatted date display
const formattedDate = computed(() => {
  if (!props.date) return ''
  const d = props.date instanceof Date ? props.date : new Date(props.date)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
})
</script>

<template>
  <!-- Picker mode: calendar inside a popover -->
  <UPopover v-if="picker && !range && !isYearMode">
    <UButton
      icon="i-lucide-calendar"
      :label="formattedDate || placeholder || t('calendar.placeholder')"
      :color="formattedDate ? 'neutral' : 'neutral'"
      variant="outline"
      :disabled="disabled"
      class="w-full justify-start"
      :size="size"
    />

    <template #content>
      <UCalendar
        v-model="internalDate"
        :color="color"
        :variant="variant"
        :size="size"
        :min-value="minCalendarDate"
        :max-value="maxCalendarDate"
        :month-controls="monthControls"
        :year-controls="yearControls"
        :is-date-disabled="isDateDisabled ? internalIsDateDisabled : undefined"
        :ui="ui"
      >
        <template
          v-if="hasDaySlot"
          #day="{ day }"
        >
          <slot
            name="day"
            :day="day"
            :date="calendarDateToDate(day)"
          />
        </template>
      </UCalendar>
    </template>
  </UPopover>

  <!-- Year grid mode (12 months) -->
  <div
    v-else-if="isYearMode"
    class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
  >
    <div
      v-for="{ month, placeholder } in months"
      :key="month"
      class="bg-elevated rounded-lg p-3 ring ring-default"
    >
      <UCalendar
        v-model="internalDate"
        :placeholder="placeholder"
        :month-controls="false"
        :year-controls="false"
        :size="size"
        :color="color"
        :variant="variant"
        :disabled="disabled"
        :fixed-weeks="false"
        :min-value="minCalendarDate"
        :max-value="maxCalendarDate"
        :is-date-disabled="isDateDisabled ? internalIsDateDisabled : undefined"
        :ui="ui"
        class="hide-outside-days"
      >
        <template
          v-if="hasDaySlot"
          #day="{ day }"
        >
          <slot
            name="day"
            :day="day"
            :date="calendarDateToDate(day)"
          />
        </template>
      </UCalendar>
    </div>
  </div>

  <!-- Single date mode (with optional numberOfMonths) -->
  <UCalendar
    v-else-if="!range"
    v-model="internalDate"
    :color="color"
    :variant="variant"
    :size="size"
    :disabled="disabled"
    :min-value="minCalendarDate"
    :max-value="maxCalendarDate"
    :month-controls="monthControls"
    :year-controls="yearControls"
    :number-of-months="displayMonths"
    :is-date-disabled="isDateDisabled ? internalIsDateDisabled : undefined"
    :ui="ui"
  >
    <template
      v-if="hasDaySlot"
      #day="{ day }"
    >
      <slot
        name="day"
        :day="day"
        :date="calendarDateToDate(day)"
      />
    </template>
  </UCalendar>

  <!-- Range mode -->
  <UCalendar
    v-else
    v-model="internalRange"
    range
    :color="color"
    :variant="variant"
    :size="size"
    :disabled="disabled"
    :min-value="minCalendarDate"
    :max-value="maxCalendarDate"
    :month-controls="monthControls"
    :year-controls="yearControls"
    :number-of-months="displayMonths"
    :is-date-disabled="isDateDisabled ? internalIsDateDisabled : undefined"
    :ui="ui"
  >
    <template
      v-if="hasDaySlot"
      #day="{ day }"
    >
      <slot
        name="day"
        :day="day"
        :date="calendarDateToDate(day)"
      />
    </template>
  </UCalendar>
</template>

<style scoped>
/* Hide days from other months in year grid mode */
.hide-outside-days :deep([data-outside-view]),
.hide-outside-days :deep([data-outside-month]),
.hide-outside-days :deep([data-outside-visible-months]) {
  visibility: hidden;
}
</style>
