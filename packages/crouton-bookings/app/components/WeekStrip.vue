<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import { CalendarDate, today, getLocalTimeZone } from '@internationalized/date'

interface Props {
  modelValue?: Date | null
  weekStartsOn?: 0 | 1 // 0 = Sunday, 1 = Monday
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'beams' | 'bars'
  /** Dates to highlight (selected dates from click multi-select) */
  selectedDates?: Date[]
  /** Date currently being used for booking creation */
  creatingAtDate?: Date | null
  /** Function to check if a date is disabled by schedule rules */
  isDateDisabled?: ((date: Date) => boolean) | null
  /** Function to check if a date is fully booked (all slots taken) */
  isDayFullyBooked?: ((date: Date) => boolean) | null
}

const { t } = useT()

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  weekStartsOn: 1, // Monday default
  size: 'md',
  variant: 'default',
  selectedDates: () => [],
  creatingAtDate: null,
  isDateDisabled: null,
  isDayFullyBooked: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: Date | null]
  'select': [value: Date | null]
  'dayClick': [value: Date]
}>()

const { locale } = useI18n()

// Current week's reference date (for navigation)
const referenceDate = ref(today(getLocalTimeZone()))

// Compute the start of the week, `offset` weeks away from the reference date
function weekStartFor(offset: number) {
  const ref = referenceDate.value.add({ weeks: offset })
  const dayOfWeek = ref.toDate(getLocalTimeZone()).getDay()
  const diff = props.weekStartsOn === 1
    ? (dayOfWeek === 0 ? -6 : 1 - dayOfWeek) // Monday start
    : -dayOfWeek // Sunday start
  return ref.add({ days: diff })
}

const weekStart = computed(() => weekStartFor(0))

// Generate array of 7 days for the week `offset` weeks away
function daysFor(offset: number) {
  const days = []
  for (let i = 0; i < 7; i++) {
    const date = weekStartFor(offset).add({ days: i })
    days.push({
      date,
      day: date.day,
      weekday: new Intl.DateTimeFormat(locale.value, { weekday: 'short' }).format(date.toDate(getLocalTimeZone())),
      weekdayShort: new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' }).format(date.toDate(getLocalTimeZone())),
      jsDate: date.toDate(getLocalTimeZone()),
    })
  }
  return days
}

// prev · current · next — the neighbours peek in while dragging (#2515)
const panels = computed(() => [-1, 0, 1].map(offset => ({ offset, days: daysFor(offset) })))

// Format week label for header (like "December 2025")
const weekLabel = computed(() => {
  const start = weekStart.value
  const end = start.add({ days: 6 })
  const startDate = start.toDate(getLocalTimeZone())
  const endDate = end.toDate(getLocalTimeZone())

  const monthYear = new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' })

  // If same month, show "December 2025"
  if (start.month === end.month) {
    return monthYear.format(startDate)
  }
  // If different months, show "Dec - Jan 2025" or "Dec 2024 - Jan 2025"
  const startMonth = new Intl.DateTimeFormat(locale.value, { month: 'short' }).format(startDate)
  const endMonthYear = new Intl.DateTimeFormat(locale.value, { month: 'short', year: 'numeric' }).format(endDate)
  return `${startMonth} - ${endMonthYear}`
})

// Navigation
function prevWeek() {
  referenceDate.value = referenceDate.value.subtract({ weeks: 1 })
}

function nextWeek() {
  referenceDate.value = referenceDate.value.add({ weeks: 1 })
}

// Horizontal swipe on the strip: the panels follow the finger, then slide to
// the next/previous week or spring back. Vertical drags pass through to the
// page (touch-action: pan-y) (#2485, #2515)
const swipeEl = ref<HTMLElement | null>(null)
const { slide, style: trackStyle } = useSlideSwipe(swipeEl, {
  peek: true,
  onNext: nextWeek,
  onPrev: prevWeek,
})

function goToToday() {
  referenceDate.value = today(getLocalTimeZone())
}

function goToDate(date: Date) {
  referenceDate.value = new CalendarDate(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  )
}

// Expose methods for parent control
defineExpose({
  goToDate,
  goToToday,
})

function isToday(day: { date: DateValue }): boolean {
  const todayDate = today(getLocalTimeZone())
  return day.date.compare(todayDate) === 0
}

function isHighlighted(day: { jsDate: Date }): boolean {
  return props.selectedDates.some(d =>
    day.jsDate.getFullYear() === d.getFullYear()
    && day.jsDate.getMonth() === d.getMonth()
    && day.jsDate.getDate() === d.getDate(),
  )
}

// Check if we're in create mode
const isCreating = computed(() => props.creatingAtDate !== null)

// Check if a date is the creating date
function isCreatingDate(day: { jsDate: Date }): boolean {
  if (!props.creatingAtDate) return false
  return (
    day.jsDate.getFullYear() === props.creatingAtDate.getFullYear()
    && day.jsDate.getMonth() === props.creatingAtDate.getMonth()
    && day.jsDate.getDate() === props.creatingAtDate.getDate()
  )
}

function isDayDisabled(day: { jsDate: Date }): boolean {
  return props.isDateDisabled?.(day.jsDate) ?? false
}

function isFullyBooked(day: { jsDate: Date }): boolean {
  return props.isDayFullyBooked?.(day.jsDate) ?? false
}

function onDayClick(day: { date: DateValue, jsDate: Date }) {
  // Click toggles date selection
  emit('select', day.jsDate)
}

function onAddClick(event: Event, day: { date: DateValue, jsDate: Date }) {
  event.stopPropagation() // Don't trigger day click
  emit('dayClick', day.jsDate)
}

// Size classes
const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return {
        header: 'text-sm',
        weekday: 'text-xs',
        day: 'text-lg',
        cell: 'py-2',
      }
    case 'md':
      return {
        header: 'text-base',
        weekday: 'text-xs',
        day: 'text-xl',
        cell: 'py-3',
      }
    case 'lg':
    default:
      return {
        header: 'text-lg',
        weekday: 'text-sm',
        day: 'text-2xl',
        cell: 'py-4',
      }
  }
})
</script>

<template>
  <div class="flex flex-col touch-pan-y">
    <!-- Header: Nav + Month Label (calendar style) -->
    <div class="flex items-center justify-center gap-1">
      <UButton
        icon="i-lucide-chevrons-left"
        variant="ghost"
        color="neutral"
        size="sm"
        :aria-label="t('bookings.weekStrip.previousWeek')"
        @click="slide('prev')"
      />
      <UButton
        variant="ghost"
        color="neutral"
        :class="['font-medium', sizeClasses.header]"
        @click="goToToday"
      >
        {{ weekLabel }}
      </UButton>
      <UButton
        icon="i-lucide-chevrons-right"
        variant="ghost"
        color="neutral"
        size="sm"
        :aria-label="t('bookings.weekStrip.nextWeek')"
        @click="slide('next')"
      />
    </div>

    <!-- Days Grid -->
    <div ref="swipeEl" class="overflow-hidden touch-pan-y pb-5 -mb-5">
    <div class="flex" :style="trackStyle">
    <div
      v-for="panel in panels"
      :key="panel.offset"
      class="grid grid-cols-7 gap-2 min-w-full shrink-0"
      :inert="panel.offset !== 0 || undefined"
      :aria-hidden="panel.offset !== 0 || undefined"
    >
      <!-- Wrapper keeps the add-booking tab a SIBLING of the clickable day
           cell — a role="button" cell containing a real <button> is a nested
           interactive control (axe serious). -->
      <div
        v-for="day in panel.days"
        :key="day.date.toString()"
        class="group relative"
      >
      <div
        class="flex flex-col items-center cursor-pointer rounded-lg transition-all duration-150 px-1"
        :class="[
          sizeClasses.cell,
          isDayDisabled(day)
            ? 'opacity-40'
            : 'hover:bg-elevated',
          isCreatingDate(day)
            ? 'bg-elevated shadow-md'
            : isHighlighted(day) && 'bg-elevated shadow-sm',
        ]"
        role="button"
        :tabindex="isDayDisabled(day) ? -1 : 0"
        @click="onDayClick(day)"
        @keydown.enter.prevent="onDayClick(day)"
        @keydown.space.prevent="onDayClick(day)"
      >
        <!-- Weekday label -->
        <span :class="['text-muted uppercase tracking-wider font-medium', sizeClasses.weekday]">
          {{ day.weekdayShort }}
        </span>

        <!-- Day number -->
        <span
          :class="[
            'font-medium transition-colors',
            sizeClasses.day,
            isDayDisabled(day)
              ? 'text-muted line-through'
              : isToday(day) ? 'text-primary' : 'text-default',
          ]"
        >
          {{ day.day }}
        </span>

        <!-- Slot for indicators -->
        <slot name="day" :day="day.date" :js-date="day.jsDate">
          <div class="mt-1 min-h-[8px]" />
        </slot>
      </div>

        <!-- Add booking tab (slides down from under the date block on hover) -->
        <!-- Deliberately a raw button (#1410): a calendar hover cell whose
             geometry (absolute slide-down tab under the date block) and
             booked-state colors are the widget itself — no Nuxt UI equivalent.
             Colors use semantic tokens where possible. -->
        <button
          v-if="!isCreatingDate(day)"
          type="button"
          :disabled="isFullyBooked(day)"
          :aria-label="t(isFullyBooked(day) ? 'bookings.weekStrip.fullyBookedDay' : 'bookings.weekStrip.addBookingDay', { day: `${day.weekdayShort} ${day.day}` })"
          class="absolute bottom-0 left-0 right-0 translate-y-0 flex items-center justify-center h-6 rounded-b-lg opacity-0 transition-all duration-200 ease-out group-hover:translate-y-4 group-hover:opacity-100 z-10"
          :class="isFullyBooked(day)
            ? 'bg-neutral-700 cursor-default'
            : 'bg-primary cursor-pointer hover:bg-primary/80 active:scale-[0.98]'"
          @click="!isFullyBooked(day) && onAddClick($event, day)"
        >
          <UIcon
            :name="isFullyBooked(day) ? 'i-lucide-check' : 'i-lucide-plus'"
            class="size-3.5"
            :class="isFullyBooked(day) ? 'text-neutral-500' : 'text-neutral-300'"
          />
        </button>
      </div>
    </div>
    </div>
    </div>
  </div>
</template>
