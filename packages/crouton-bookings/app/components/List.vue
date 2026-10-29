<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import { toDateKey, isSameDay } from '@fyit/crouton-core/shared/utils/date'
import type { Booking } from '../types/booking'

interface Props {
  /** Bookings to display. If not provided, will fetch using useBookingsList */
  bookings?: Booking[]
  /** Loading state. If not provided, will use internal state */
  loading?: boolean
  /** Error state. If not provided, will use internal state */
  error?: Error | null
  /** Empty state message */
  emptyMessage?: string
  /** Whether filters are active (changes empty state message) */
  hasActiveFilters?: boolean
  /** The selected day (from the calendar) */
  selectedDate?: Date | null
  /** Specific booking ID to highlight (from calendar indicator hover) */
  highlightedBookingId?: string | null
  /** Date where inline creation card should appear */
  creatingAtDate?: Date | null
  /** Day to scroll to. A fresh Date each time, so the same day can be targeted again. */
  scrollTarget?: Date | null
  /** Active location filter - when set, only these locations are selectable in create form */
  activeLocationFilter?: string[]
  /** Whether every location is fully booked on a date (disables the New booking row) */
  isDayFullyBooked?: (date: Date) => boolean
  /** Scroll container the list lives in (IntersectionObserver root) */
  scrollRoot?: HTMLElement | null
}

const props = withDefaults(defineProps<Props>(), {
  bookings: undefined,
  loading: undefined,
  error: undefined,
  emptyMessage: undefined,
  hasActiveFilters: false,
  selectedDate: null,
  highlightedBookingId: null,
  creatingAtDate: null,
  scrollTarget: null,
  activeLocationFilter: undefined,
  isDayFullyBooked: undefined,
  scrollRoot: null,
})

const emit = defineEmits<{
  created: []
  cancelCreate: []
  /** Emitted when the top visible date changes (week changed during scroll) */
  topVisibleDateChange: [date: Date]
  /** Emitted when clicking on a booking's date visualization */
  dateClick: [date: Date]
  /** Emitted when a booking is updated */
  updated: []
  /** Emitted when an email is sent (so parent can refresh email stats) */
  emailSent: []
  /** Emitted when the ghost "New booking" row of a day is tapped */
  newBooking: [date: Date]
}>()

// Recently created booking IDs for highlight effect
const { lastCreatedBookingIds } = useBookingCart()

// Track which booking is being edited (inline edit mode)
const editingBookingId = ref<string | null>(null)

// Handle edit click - show inline edit form
function handleEditClick(booking: Booking) {
  editingBookingId.value = booking.id
}

// Handle edit cancel
function handleEditCancel() {
  editingBookingId.value = null
}

// Handle booking updated
function handleBookingUpdated() {
  editingBookingId.value = null
  handleRefresh()
  emit('updated')
}

// Use composable for fetching if bookings not provided
const listData = props.bookings === undefined ? useBookingsList() : null

// Resolved values - use props if provided, otherwise use composable
const resolvedBookings = computed(() => {
  return props.bookings ?? listData?.bookings.value ?? []
})

const resolvedLoading = computed(() => {
  return props.loading ?? listData?.loading.value ?? false
})

const resolvedError = computed(() => {
  return props.error ?? listData?.error.value ?? null
})

// Refresh function (only available when using composable)
function handleRefresh() {
  listData?.refresh()
}

// Email functionality
const { resendEmail, isEmailEnabled } = useBookingEmail()
const notify = useNotify()
const { t } = useT()
const { locale } = useI18n()

// Resolved empty message with i18n default
const resolvedEmptyMessage = computed(() => props.emptyMessage ?? t('bookings.list.defaultEmptyMessage'))
const { teamId: contextTeamId } = useTeamContext()

// Track which booking/email type is currently being sent
const sendingEmailState = ref<{ bookingId: string; triggerType: string } | null>(null)

// Handle resend email from BookingCard
async function handleResendEmail(booking: Booking, triggerType: string) {
  if (!isEmailEnabled.value) return

  // Use booking's teamId (more reliable than route params)
  const teamId = booking.teamId || contextTeamId.value
  if (!teamId) {
    console.error('[List] No teamId available for email send')
    return
  }

  sendingEmailState.value = { bookingId: booking.id, triggerType }

  try {
    const result = await resendEmail(teamId, booking.id, triggerType as any)

    if (result.success) {
      notify.success(t('bookings.notifications.emailSent'), { description: t('bookings.notifications.emailSentDescription') })
      // Refresh the list to update email stats
      handleRefresh()
      // Emit so parent can refresh if using external data
      emit('emailSent')
    }
    else {
      notify.error(t('bookings.notifications.emailFailed'), { description: result.error || t('bookings.notifications.errorOccurred') })
    }
  }
  catch (error: any) {
    notify.error(t('bookings.notifications.emailFailed'), { description: error.message || t('bookings.notifications.errorOccurred') })
  }
  finally {
    sendingEmailState.value = null
  }
}

// Get the sending email type for a specific booking
function getSendingEmailType(bookingId: string): string | null {
  if (sendingEmailState.value?.bookingId === bookingId) {
    return sendingEmailState.value.triggerType
  }
  return null
}

// Map of date keys to element refs for scroll targeting
const dateElementRefs = ref<Map<string, HTMLElement>>(new Map())

// Group bookings by month/year for separators, with date subgroups for scrolling
interface DateGroup {
  dateKey: string
  date: Date
  bookings: Booking[]
  isCreatePlaceholder?: boolean
}

interface MonthGroup {
  key: string
  label: string
  dateGroups: DateGroup[]
}

// Bookings grouped by day, plus an empty section for the creation date and the selected day
const groupedBookings = computed((): MonthGroup[] => {
  const days = new Map<string, DateGroup>()
  const dayFor = (date: Date, isCreatePlaceholder = false) => {
    const dateKey = toDateKey(date)
    let day = days.get(dateKey)
    if (!day) {
      day = { dateKey, date: new Date(date), bookings: [], isCreatePlaceholder }
      days.set(dateKey, day)
    }
    return day
  }

  for (const booking of resolvedBookings.value) {
    dayFor(new Date(booking.date)).bookings.push(booking)
  }
  if (props.creatingAtDate) dayFor(props.creatingAtDate, true)
  if (props.selectedDate) dayFor(props.selectedDate)

  const months = new Map<string, MonthGroup>()
  const sortedDays = [...days.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
  for (const day of sortedDays) {
    const key = `${day.date.getFullYear()}-${String(day.date.getMonth()).padStart(2, '0')}`
    let month = months.get(key)
    if (!month) {
      const label = new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(day.date)
      month = { key, label, dateGroups: [] }
      months.set(key, month)
    }
    month.dateGroups.push(day)
  }
  return [...months.values()]
})

// Get ISO week key to detect week changes
function getWeekKey(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const yearStart = new Date(d.getFullYear(), 0, 1)
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getFullYear()}-W${weekNum}`
}

// Report the top visible day to the calendar when its week changes
let lastEmittedWeek: string | null = null
useIntersectionObserver(
  () => [...dateElementRefs.value.values()],
  (entries) => {
    // Find topmost visible date group
    let topEntry: IntersectionObserverEntry | null = null
    let topY = Infinity

    for (const entry of entries) {
      if (entry.isIntersecting && entry.boundingClientRect.top < topY && entry.boundingClientRect.top >= 0) {
        topY = entry.boundingClientRect.top
        topEntry = entry
      }
    }

    const dateKey = topEntry?.target.getAttribute('data-date-key')
    if (!dateKey) return
    const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number]
    const date = new Date(year, month - 1, day)
    const weekKey = getWeekKey(date)
    if (weekKey !== lastEmittedWeek) {
      lastEmittedWeek = weekKey
      emit('topVisibleDateChange', date)
    }
  },
  { root: () => props.scrollRoot, rootMargin: '-10% 0px -80% 0px', threshold: 0 }, // Top 10-20% of viewport triggers
)

// Register the element of a date section for scroll targeting
function setDateRef(dateKey: string, el: HTMLElement | null) {
  if (el) {
    dateElementRefs.value.set(dateKey, el)
    el.setAttribute('data-date-key', dateKey)
  } else {
    dateElementRefs.value.delete(dateKey)
  }
}

// Handle click on booking date - emit to navigate calendar
function onBookingDateClick(date: Date) {
  emit('dateClick', date)
}

// The one scroll path: bring the target day's section into view once the DOM has it
watch(
  () => props.scrollTarget,
  (target) => {
    if (!target) return
    dateElementRefs.value.get(toDateKey(target))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  },
  { flush: 'post' },
)

// Whether a day section is the calendar-selected day (shows the New booking row)
function isSelectedDateKey(dateKey: string): boolean {
  return !!props.selectedDate && toDateKey(props.selectedDate) === dateKey
}

// Check if a booking should be highlighted
function isHighlighted(booking: Booking): boolean {
  // Prioritize specific booking ID highlight (from indicator hover)
  if (props.highlightedBookingId) {
    return booking.id === props.highlightedBookingId
  }

  // Fall back to date-based highlight (from calendar day selection)
  return !!props.selectedDate && isSameDay(new Date(booking.date), props.selectedDate)
}

// Creation date key for positioning the inline create card
const creatingAtDateKey = computed(() => {
  if (!props.creatingAtDate) return null
  return toDateKey(props.creatingAtDate)
})

</script>

<template>
  <div class="space-y-4">
    <!-- Loading state -->
    <div v-if="resolvedLoading" class="flex flex-col gap-3">
      <div v-for="i in 5" :key="i" class="bg-elevated/50 rounded-lg p-3 animate-pulse">
        <div class="flex items-center gap-3">
          <div class="w-16 h-16 bg-elevated rounded-lg" />
          <div class="flex-1 space-y-2">
            <div class="h-4 bg-elevated rounded w-1/3" />
            <div class="h-3 bg-elevated rounded w-1/4" />
          </div>
          <div class="h-6 bg-elevated rounded w-16" />
        </div>
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="resolvedError" class="bg-error/10 border border-error/20 rounded-lg p-6 text-center">
      <UIcon name="i-lucide-alert-circle" class="w-8 h-8 text-error mx-auto mb-2" />
      <p class="text-sm text-error font-medium">{{ t('bookings.list.failedToLoad') }}</p>
      <p class="text-xs text-muted mt-1">{{ resolvedError.message || $t('bookings.notifications.errorOccurred') }}</p>
      <UButton
        v-if="listData"
        variant="soft"
        color="error"
        size="sm"
        class="mt-3"
        @click="handleRefresh"
      >
        {{ t('bookings.list.tryAgain') }}
      </UButton>
    </div>

    <!-- Empty state (but might have create card) -->
    <div v-else-if="resolvedBookings.length === 0 && !selectedDate">
      <!-- Inline create card when empty -->
      <div v-if="creatingAtDate">
        <CroutonBookingsBookingCreateCard
          :date="creatingAtDate"
          :active-location-filter="activeLocationFilter"
          @created="emit('created')"
          @cancel="emit('cancelCreate')"
        />
      </div>

      <!-- Empty message when not creating -->
      <div v-else class="bg-elevated/50 rounded-lg p-8 text-center">
        <UIcon
          :name="hasActiveFilters ? 'i-lucide-filter-x' : 'i-lucide-calendar-x'"
          class="w-12 h-12 text-muted mx-auto mb-3"
        />
        <p class="text-sm font-medium">
          {{ hasActiveFilters ? t('bookings.list.noMatching') : t('bookings.list.noBookings') }}
        </p>
        <p class="text-xs text-muted mt-1">
          {{ hasActiveFilters ? t('bookings.list.adjustFilters') : resolvedEmptyMessage }}
        </p>
      </div>
    </div>

    <!-- Bookings list with month/year separators -->
    <div v-else class="flex flex-col gap-4">
      <div v-for="monthGroup in groupedBookings" :key="monthGroup.key" class="flex flex-col gap-2">
        <!-- Month/Year separator -->
        <div class="flex items-center gap-3 py-2">
          <div class="h-px w-4 bg-muted/30" />
          <span class="text-xs font-medium text-muted/60 uppercase tracking-widest">
            {{ monthGroup.label }}
          </span>
          <div class="flex-1 h-px bg-muted/30" />
        </div>

        <!-- Date groups within month -->
        <div
          v-for="dateGroup in monthGroup.dateGroups"
          :key="dateGroup.dateKey"
          :ref="(el) => setDateRef(dateGroup.dateKey, el as HTMLElement)"
          class="flex flex-col gap-1.5"
        >
          <!-- Create card for placeholder date (new date with no bookings) -->
          <div
            v-if="dateGroup.isCreatePlaceholder && creatingAtDate"
          >
            <CroutonBookingsBookingCreateCard
              :date="creatingAtDate"
              :active-location-filter="activeLocationFilter"
              @created="emit('created')"
              @cancel="emit('cancelCreate')"
            />
          </div>

          <!-- Bookings for this date -->
          <template v-else>
            <!-- Inline create card at TOP if creating at this date (existing date with bookings) -->
            <div
              v-if="creatingAtDateKey === dateGroup.dateKey"
            >
              <CroutonBookingsBookingCreateCard
                :date="creatingAtDate!"
                :active-location-filter="activeLocationFilter"
                @created="emit('created')"
                @cancel="emit('cancelCreate')"
              />
            </div>

            <template v-for="booking in dateGroup.bookings" :key="booking.id">
              <!-- Show edit card if this booking is being edited -->
              <CroutonBookingsBookingCreateCard
                v-if="editingBookingId === booking.id"
                :date="new Date(booking.date)"
                :booking="booking"
                :active-location-filter="activeLocationFilter"
                @updated="handleBookingUpdated"
                @cancelled="handleBookingUpdated"
                @cancel="handleEditCancel"
              />
              <!-- Show normal card otherwise -->
              <CroutonBookingsBookingCard
                v-else
                :booking="booking"
                :highlighted="isHighlighted(booking)"
                :just-created="(lastCreatedBookingIds as any).includes(booking.id)"
                :sending-email-type="getSendingEmailType(booking.id) as any"
                @date-click="onBookingDateClick"
                @resend-email="(triggerType) => handleResendEmail(booking, triggerType)"
                @edit="handleEditClick(booking)"
              />
            </template>

            <!-- Ghost row for the selected day: shaped like a booking card, dashed, starts a
                 booking for that date. On a day without bookings it also says so. -->
            <UButton
              v-if="isSelectedDateKey(dateGroup.dateKey) && creatingAtDateKey !== dateGroup.dateKey"
              block
              variant="ghost"
              color="neutral"
              class="justify-start gap-3 p-1.5 md:p-2 rounded-lg border border-dashed border-accented text-muted hover:border-primary hover:text-primary hover:bg-primary/5 disabled:opacity-60"
              :disabled="isDayFullyBooked?.(new Date(dateGroup.date))"
              @click="emit('newBooking', new Date(dateGroup.date))"
            >
              <template v-if="dateGroup.bookings.length === 0" #leading>
                <CroutonBookingsDateBadge :date="dateGroup.date" variant="muted" />
              </template>
              <span class="flex items-center gap-1.5 text-sm font-medium">
                <UIcon
                  :name="isDayFullyBooked?.(new Date(dateGroup.date)) ? 'i-lucide-check' : 'i-lucide-plus'"
                  class="size-4"
                />
                {{ isDayFullyBooked?.(new Date(dateGroup.date)) ? t('bookings.calendar.fullyBooked') : t('bookings.calendar.newBooking') }}
              </span>
              <template v-if="dateGroup.bookings.length === 0" #trailing>
                <span class="ms-auto text-xs text-dimmed">{{ t('bookings.calendar.noBookings') }}</span>
              </template>
            </UButton>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
