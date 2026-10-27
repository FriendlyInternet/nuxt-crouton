<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, type ComponentPublicInstance } from 'vue'
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
  /** Dates to highlight (from calendar multi-select) */
  selectedDates?: Date[]
  /** Specific booking ID to highlight (from calendar indicator hover) */
  highlightedBookingId?: string | null
  /** Date where inline creation card should appear */
  creatingAtDate?: Date | null
  /** Date to scroll to (after booking creation) */
  scrollToDate?: Date | null
  /** Active location filter - when set, only these locations are selectable in create form */
  activeLocationFilter?: string[]
  /** Whether every location is fully booked on a date (disables the New booking row) */
  isDayFullyBooked?: (date: Date) => boolean
}

const props = withDefaults(defineProps<Props>(), {
  bookings: undefined,
  loading: undefined,
  error: undefined,
  emptyMessage: undefined,
  hasActiveFilters: false,
  selectedDates: () => [],
  highlightedBookingId: null,
  creatingAtDate: null,
  scrollToDate: null,
  activeLocationFilter: undefined,
  isDayFullyBooked: undefined,
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

// Container ref for scrolling
const listContainerRef = ref<HTMLElement | null>(null)

// Map of date keys to element refs for scroll targeting
const dateElementRefs = ref<Map<string, HTMLElement>>(new Map())

// Format date as YYYY-MM-DD for map key
function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

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

const groupedBookings = computed((): MonthGroup[] => {
  // Use a Map to consolidate all bookings by month (avoids duplicate month headers)
  const monthMap = new Map<string, MonthGroup>()

  for (const booking of resolvedBookings.value) {
    const date = new Date(booking.date)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`
    const dateKey = formatDateKey(date)
    const monthLabel = new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(date)

    // Find or create month group in the Map
    let monthGroup = monthMap.get(monthKey)
    if (!monthGroup) {
      monthGroup = { key: monthKey, label: monthLabel, dateGroups: [] }
      monthMap.set(monthKey, monthGroup)
    }

    // Find or create date group within month
    let dateGroup = monthGroup.dateGroups.find(dg => dg.dateKey === dateKey)
    if (!dateGroup) {
      dateGroup = { dateKey, date: new Date(date), bookings: [] }
      monthGroup.dateGroups.push(dateGroup)
    }

    dateGroup.bookings.push(booking)
  }

  // Sort month keys chronologically and convert Map to array
  const sortedMonthKeys = [...monthMap.keys()].sort()
  const monthGroups = sortedMonthKeys.map(key => monthMap.get(key)!)

  // Sort date groups within each month chronologically
  for (const monthGroup of monthGroups) {
    monthGroup.dateGroups.sort((a, b) => a.date.getTime() - b.date.getTime())
  }

  return monthGroups
})

// Insert an empty date group (creation target or selected day without bookings) in date order
function insertEmptyDateGroup(result: MonthGroup[], createDate: Date, isCreatePlaceholder: boolean) {
  const createMonthKey = `${createDate.getFullYear()}-${String(createDate.getMonth()).padStart(2, '0')}`
  const createDateKey = formatDateKey(createDate)
  const createMonthLabel = new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(createDate)

  // Find or create the month group for the creation date
  let monthIndex = result.findIndex(mg => mg.key === createMonthKey)

  if (monthIndex === -1) {
    // Need to insert a new month group in the correct position
    const newMonthGroup: MonthGroup = {
      key: createMonthKey,
      label: createMonthLabel,
      dateGroups: [{
        dateKey: createDateKey,
        date: new Date(createDate),
        bookings: [],
        isCreatePlaceholder,
      }],
    }

    // Find correct position (sorted by date)
    const createTime = createDate.getTime()
    let insertIndex = result.length // default to end

    for (let i = 0; i < result.length; i++) {
      const firstDateInMonth = result[i]!.dateGroups[0]?.date
      if (firstDateInMonth && new Date(firstDateInMonth).getTime() > createTime) {
        insertIndex = i
        break
      }
    }

    result.splice(insertIndex, 0, newMonthGroup)
  }
  else {
    // Month exists, insert the date group in the correct position
    const monthGroup = result[monthIndex]!
    const createTime = createDate.getTime()

    // Find correct position within the month (sorted by date)
    let insertIndex = monthGroup.dateGroups.length // default to end

    for (let i = 0; i < monthGroup.dateGroups.length; i++) {
      const dateGroupTime = new Date(monthGroup.dateGroups[i]!.date).getTime()
      if (dateGroupTime > createTime) {
        insertIndex = i
        break
      }
    }

    monthGroup.dateGroups.splice(insertIndex, 0, {
      dateKey: createDateKey,
      date: new Date(createDate),
      bookings: [],
      isCreatePlaceholder,
    })
  }
}

// Grouped bookings plus empty sections for the creation date and every selected day without bookings
const groupedBookingsWithCreateDate = computed((): MonthGroup[] => {
  const baseGroups = groupedBookings.value
  const existingKeys = new Set(allDateKeys.value)
  const extraDates: { date: Date, isCreatePlaceholder: boolean }[] = []

  if (props.creatingAtDate && !creatingDateHasBookings.value) {
    extraDates.push({ date: props.creatingAtDate, isCreatePlaceholder: true })
    existingKeys.add(formatDateKey(props.creatingAtDate))
  }
  for (const date of props.selectedDates ?? []) {
    const key = formatDateKey(date)
    if (existingKeys.has(key)) continue
    existingKeys.add(key)
    extraDates.push({ date, isCreatePlaceholder: false })
  }

  if (extraDates.length === 0) return baseGroups

  // Create a deep copy to avoid mutating the original
  const result: MonthGroup[] = JSON.parse(JSON.stringify(baseGroups))
  for (const { date, isCreatePlaceholder } of extraDates) {
    insertEmptyDateGroup(result, date, isCreatePlaceholder)
  }
  return result
})

// Get all unique date keys for scroll targeting
const allDateKeys = computed(() => {
  const keys: string[] = []
  for (const monthGroup of groupedBookings.value) {
    for (const dateGroup of monthGroup.dateGroups) {
      keys.push(dateGroup.dateKey)
    }
  }
  return keys
})

// Find the nearest date key to scroll to (for dates without bookings)
function findNearestDateKey(targetDate: Date): string | null {
  const targetKey = formatDateKey(targetDate)
  const keys = allDateKeys.value

  if (keys.length === 0) return null
  if (keys.includes(targetKey)) return targetKey

  // Find nearest date
  const targetTime = targetDate.getTime()
  let nearestKey = keys[0]!
  let nearestDiff = Infinity

  for (const key of keys) {
    const [year, month, day] = key.split('-').map(Number) as [number, number, number]
    const keyDate = new Date(year, month - 1, day)
    const diff = Math.abs(keyDate.getTime() - targetTime)

    if (diff < nearestDiff) {
      nearestDiff = diff
      nearestKey = key
    }
  }

  return nearestKey
}

// Track top visible date for calendar sync
const lastEmittedWeek = ref<string | null>(null)
const observer = ref<IntersectionObserver | null>(null)

// Get ISO week key to detect week changes
function getWeekKey(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const yearStart = new Date(d.getFullYear(), 0, 1)
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getFullYear()}-W${weekNum}`
}

// IntersectionObserver callback to find top visible date group
function observerCallback(entries: IntersectionObserverEntry[]) {
  // Find topmost visible date group
  let topEntry: IntersectionObserverEntry | null = null
  let topY = Infinity

  for (const entry of entries) {
    if (entry.isIntersecting && entry.boundingClientRect.top < topY && entry.boundingClientRect.top >= 0) {
      topY = entry.boundingClientRect.top
      topEntry = entry
    }
  }

  if (topEntry) {
    const dateKey = topEntry.target.getAttribute('data-date-key')
    if (dateKey) {
      const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number]
      const date = new Date(year, month - 1, day)
      const weekKey = getWeekKey(date)

      // Only emit if week changed
      if (weekKey !== lastEmittedWeek.value) {
        lastEmittedWeek.value = weekKey
        emit('topVisibleDateChange', date)
      }
    }
  }
}

// Register element ref for a date and observe for scroll tracking
function setDateRef(dateKey: string, el: HTMLElement | null) {
  if (el) {
    dateElementRefs.value.set(dateKey, el)
    el.setAttribute('data-date-key', dateKey)
    observer.value?.observe(el)
  } else {
    const existing = dateElementRefs.value.get(dateKey)
    if (existing) {
      observer.value?.unobserve(existing)
    }
    dateElementRefs.value.delete(dateKey)
  }
}

// Set up IntersectionObserver on mount
onMounted(() => {
  observer.value = new IntersectionObserver(observerCallback, {
    rootMargin: '-10% 0px -80% 0px', // Top 10-20% of viewport triggers
    threshold: 0,
  })

  // Observe any already-registered elements
  for (const el of dateElementRefs.value.values()) {
    observer.value.observe(el)
  }
})

// Clean up observer on unmount
onUnmounted(() => {
  observer.value?.disconnect()
})

// Handle click on booking date - emit to navigate calendar
function onBookingDateClick(date: Date) {
  emit('dateClick', date)
}

// Flag to temporarily disable highlight scroll during creation scroll
const isScrollingToCreated = ref(false)

// Watch for selected dates changes and scroll to the latest one
watch(
  () => props.selectedDates,
  (dates) => {
    // Skip if we're scrolling to a newly created booking
    if (isScrollingToCreated.value) return
    if (!dates || dates.length === 0) return

    // Scroll to the most recently added date (last in array)
    const latestDate = dates[dates.length - 1]!
    const targetKey = formatDateKey(latestDate)

    // flush: 'post' — runs after the DOM update, so a day without bookings already has its section
    const element = dateElementRefs.value.get(targetKey)
    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  },
  { deep: true, flush: 'post' },
)

// Watch for scrollToDate changes (after booking creation)
watch(
  () => props.scrollToDate,
  (newDate) => {
    if (!newDate) return

    // Disable highlight scroll temporarily
    isScrollingToCreated.value = true

    // Wait for DOM to update with new booking
    nextTick(() => {
      const targetKey = formatDateKey(newDate)
      const element = dateElementRefs.value.get(targetKey)

      if (element) {
        element.scrollIntoView({
          behavior: 'instant',
          block: 'center',
        })
      }
      // Re-enable highlight scroll shortly after
      setTimeout(() => {
        isScrollingToCreated.value = false
      }, 100)
    })
  },
)

// Whether a day section belongs to a calendar-selected date (shows the New booking row)
function isSelectedDateKey(dateKey: string): boolean {
  return (props.selectedDates ?? []).some(d => formatDateKey(d) === dateKey)
}

// Check if a booking should be highlighted
function isHighlighted(booking: Booking): boolean {
  // Prioritize specific booking ID highlight (from indicator hover)
  if (props.highlightedBookingId) {
    return booking.id === props.highlightedBookingId
  }

  // Fall back to date-based highlight (from calendar day selection)
  if (!props.selectedDates || props.selectedDates.length === 0) return false
  const bookingDate = new Date(booking.date)
  return props.selectedDates.some(d =>
    bookingDate.getFullYear() === d.getFullYear()
    && bookingDate.getMonth() === d.getMonth()
    && bookingDate.getDate() === d.getDate(),
  )
}

// Creation date key for positioning the inline create card
const creatingAtDateKey = computed(() => {
  if (!props.creatingAtDate) return null
  return formatDateKey(props.creatingAtDate)
})

// Check if creating at date is in an existing date group
const creatingDateHasBookings = computed(() => {
  if (!creatingAtDateKey.value) return false
  return allDateKeys.value.includes(creatingAtDateKey.value)
})

// Ref for the create card element - use callback ref to handle multiple conditional refs
const createCardElement = ref<HTMLElement | null>(null)

// Callback ref setter - ensures we always get the element, not an array
function setCreateCardRef(el: Element | ComponentPublicInstance | null) {
  // Handle Vue component instances (get $el) or plain HTML elements
  if (el && '$el' in el) {
    createCardElement.value = el.$el as HTMLElement
  } else {
    createCardElement.value = el as HTMLElement | null
  }
}

// Scroll to create card when it appears
watch(
  () => props.creatingAtDate,
  (newDate) => {
    if (!newDate) return

    // Scroll to the create card
    nextTick(() => {
      const el = createCardElement.value
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }
    })
  },
)
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
    <div v-else-if="resolvedBookings.length === 0 && selectedDates.length === 0">
      <!-- Inline create card when empty -->
      <div v-if="creatingAtDate" :ref="setCreateCardRef" class="scroll-mt-4">
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
    <div v-else ref="listContainerRef" class="flex flex-col gap-4">
      <div v-for="monthGroup in groupedBookingsWithCreateDate" :key="monthGroup.key" class="flex flex-col gap-2">
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
          class="flex flex-col gap-1.5 scroll-mt-4"
        >
          <!-- Create card for placeholder date (new date with no bookings) -->
          <div
            v-if="dateGroup.isCreatePlaceholder && creatingAtDate"
            :ref="setCreateCardRef"
            class="scroll-mt-4"
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
              :ref="setCreateCardRef"
              class="scroll-mt-4"
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

            <!-- Empty selected day -->
            <p
              v-if="dateGroup.bookings.length === 0 && creatingAtDateKey !== dateGroup.dateKey"
              class="text-sm text-muted px-1 py-2"
            >
              {{ t('bookings.calendar.noBookings') }}
            </p>

            <!-- Ghost row: start a booking for this selected day -->
            <UButton
              v-if="isSelectedDateKey(dateGroup.dateKey) && creatingAtDateKey !== dateGroup.dateKey"
              block
              variant="outline"
              color="neutral"
              icon="i-lucide-plus"
              class="border-dashed"
              :disabled="isDayFullyBooked?.(new Date(dateGroup.date))"
              @click="emit('newBooking', new Date(dateGroup.date))"
            >
              {{ isDayFullyBooked?.(new Date(dateGroup.date)) ? t('bookings.calendar.fullyBooked') : t('bookings.calendar.newBooking') }}
            </UButton>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
