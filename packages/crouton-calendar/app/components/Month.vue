<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import { CalendarDate, getLocalTimeZone, today } from '@internationalized/date'

/**
 * CroutonCalendarMonth
 *
 * Swipeable month grid. Fixed header + weekday row, with a 3-panel
 * (prev · current · next) `UCalendar` track under it so the neighbour month is
 * under the finger while dragging (#2531). Day content is supplied through the
 * `#day` slot; `neighbour` is true for the prev/next panels so consumers can
 * render a cheaper cell there.
 */
const emit = defineEmits<{
  select: [value: Date]
}>()

defineSlots<{
  day(props: { day: DateValue, jsDate: Date, neighbour: boolean }): any
}>()

const { t } = useT()
const { locale } = useI18n()

const now = today(getLocalTimeZone())
const selected = ref<DateValue | undefined>(new CalendarDate(now.year, now.month, 1))
const placeholder = ref<DateValue>(new CalendarDate(now.year, now.month, 1))
const swipeEl = ref<HTMLElement | null>(null)

const isSameMonth = (a: { year: number, month: number }, b: { year: number, month: number }) =>
  a.year === b.year && a.month === b.month

const trackEl = ref<HTMLElement | null>(null)
const { slide } = useSlideSwipe(swipeEl, {
  track: trackEl,
  peek: true,
  onNext: () => { placeholder.value = placeholder.value.add({ months: 1 }) },
  onPrev: () => { placeholder.value = placeholder.value.subtract({ months: 1 }) },
})

const panels = computed(() => [-1, 0, 1].map(offset => ({
  offset,
  placeholder: placeholder.value.add({ months: offset }),
  // Reka moves a calendar's own month to its model-value's month, so only the
  // panel that actually shows the selected month may receive it (#2651).
  modelValue: selected.value && isSameMonth(selected.value, placeholder.value.add({ months: offset }))
    ? selected.value
    : undefined,
})))

const monthLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' })
    .format(placeholder.value.toDate(getLocalTimeZone())),
)

// Monday-first weekday labels (week-starts-on is 1)
const weekdays = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  // 2024-01-01 is a Monday
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)))
})

function goToToday() {
  const d = today(getLocalTimeZone())
  placeholder.value = new CalendarDate(d.year, d.month, 1)
}

function goToDate(date: Date) {
  placeholder.value = new CalendarDate(date.getFullYear(), date.getMonth() + 1, 1)
  selected.value = new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

// Day activation comes through UCalendar's own cellTrigger (a real <button>,
// so mouse AND keyboard land here) — never through handlers on the #day slot
// content. Param typed to UCalendar's emit union; this calendar is single-date.
function onActivate(value: any) {
  const single: DateValue | undefined
    = value && !Array.isArray(value) && typeof value.toDate === 'function' ? value : undefined
  selected.value = single
  // Tapping a greyed neighbour-month day selects it and slides to that month.
  if (single && !isSameMonth(single, placeholder.value)) {
    placeholder.value = new CalendarDate(single.year, single.month, 1)
  }
  if (single) emit('select', single.toDate(getLocalTimeZone()))
}

defineExpose({ goToDate, goToToday })
</script>

<template>
  <div class="flex flex-col w-full touch-pan-y">
    <div class="flex items-center justify-center gap-1">
      <UButton
        icon="i-lucide-chevrons-left"
        variant="ghost"
        color="neutral"
        size="sm"
        :aria-label="t('calendar.month.previousMonth')"
        @click="slide('prev')"
      />
      <UButton
        variant="ghost"
        color="neutral"
        class="font-medium"
        :aria-label="t('calendar.month.today')"
        @click="goToToday"
      >
        {{ monthLabel }}
      </UButton>
      <UButton
        icon="i-lucide-chevrons-right"
        variant="ghost"
        color="neutral"
        size="sm"
        :aria-label="t('calendar.month.nextMonth')"
        @click="slide('next')"
      />
    </div>
    <div class="grid grid-cols-7 px-1 pt-1" aria-hidden="true">
      <span v-for="wd in weekdays" :key="wd" class="text-center text-xs text-muted">{{ wd }}</span>
    </div>
    <div ref="swipeEl" class="w-full overflow-hidden touch-pan-y">
      <div class="flex" ref="trackEl" style="transform: translateX(-100%)">
        <div
          v-for="panel in panels"
          :key="panel.offset"
          class="w-full shrink-0"
          :inert="panel.offset !== 0 || undefined"
          :aria-hidden="panel.offset !== 0 || undefined"
        >
          <UCalendar
            :placeholder="(panel.placeholder as any)"
            :model-value="(panel.modelValue as any)"
            size="sm"
            :week-starts-on="1"
            :ui="{
              root: 'w-full',
              header: 'hidden',
              body: 'p-1 pt-0',
              grid: 'w-full',
              gridWeekDaysRow: 'hidden',
              cell: 'w-full text-center p-0.5',
              cellTrigger: 'w-full h-full p-0 rounded-md data-[selected]:bg-transparent data-[selected]:text-inherit hover:bg-transparent focus:bg-transparent',
            }"
            class="[&_table]:w-full [&_table]:table-fixed"
            @update:model-value="onActivate"
          >
            <template #day="{ day }">
              <slot
                name="day"
                :day="day"
                :js-date="day.toDate(getLocalTimeZone())"
                :neighbour="panel.offset !== 0"
              />
            </template>
          </UCalendar>
        </div>
      </div>
    </div>
  </div>
</template>
