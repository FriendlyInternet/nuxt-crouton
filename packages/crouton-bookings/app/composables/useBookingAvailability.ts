import type { DateValue } from '@internationalized/date'
import type { BlockedDateItem, SlotSchedule, SlotItem, AvailabilityData, LocationData } from '../types/booking'
import { ALL_DAY_SLOT } from '../types/booking'
import { withFullDay } from '../utils/full-day'
import { parseLocationSlots } from './useBookingSlots'
import { toDateKey as sharedToDateKey } from '@fyit/crouton-core/shared/utils/date'

export type { AvailabilityData }

export interface LocationWithInventory {
  id: string
  /** Offer the built-in full day next to named slots (#2261) */
  offerFullDay?: boolean | null
  quantity?: number
  maxBookingsPerMonth?: number | null
  slots?: SlotItem[] | string | null
  // Schedule rule fields
  openDays?: number[] | string | null
  slotSchedule?: SlotSchedule | string | null
  blockedDates?: BlockedDateItem[] | string | null
  /** Products on offer with their stock — what the counting uses (#4061) */
  products?: LocationData['products']
}

/**
 * Composable for fetching booking availability (each date's bookings per
 * product), the location's slots and its schedule rules. Counting lives in
 * `utils/capacity.ts` (+ `utils/product-left.ts` for the cart, #4110).
 *
 * Used by useBookingCart (composes this for base API availability)
 * and available standalone for admin-side availability checks.
 */
export function useBookingAvailability(
  locationId: Ref<string | null>,
  location: Ref<LocationWithInventory | null | undefined>,
) {
  const { currentTeam } = useTeam()
  const { t } = useT()
  const loading = ref(false)
  const availabilityData = ref<AvailabilityData>({})

  // Schedule rules (open days, slot schedule, blocked dates)
  const {
    isDateUnavailable,
    isSlotAvailableByRules,
    getBlockedReason,
    getRuleBlockedSlotIds,
  } = useScheduleRules(location)

  // Parse slots from location (handles string or array) — uses shared utility
  const locationSlots = computed<SlotItem[]>(() => parseLocationSlots(location.value))

  // Does the location book by slot? "No slots" = the parsed `slots` list is
  // empty — the same rule as server/utils/booking-capacity.ts (#4110, #4172).
  const hasSlots = computed(() => locationSlots.value.length > 0)

  // The slot buttons: the named slots, plus the full day next to them when the
  // location offers it (#2261). A location without slots shows none — the
  // form books its full day by itself.
  const allSlots = computed<SlotItem[]>(() => {
    if (!hasSlots.value) return []
    return withFullDay(locationSlots.value, location.value?.offerFullDay, { ...ALL_DAY_SLOT, label: t('bookings.allDay') })
  })


  // Fetch availability for a date range (client-only — auth context not available during SSR)
  async function fetchAvailability(startDate: Date, endDate: Date, excludeBookingId?: string) {
    if (import.meta.server) return
    if (!locationId.value || !currentTeam.value?.id) return

    loading.value = true
    try {
      const queryParams: Record<string, string> = {
        locationId: locationId.value,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      }
      if (excludeBookingId) {
        queryParams.excludeBookingId = excludeBookingId
      }

      const data = await $fetch<AvailabilityData>(
        `/api/crouton-bookings/teams/${currentTeam.value.id}/availability`,
        { query: queryParams },
      )
      availabilityData.value = data
    }
    catch (error) {
      console.error('Failed to fetch availability:', error)
      availabilityData.value = {}
    }
    finally {
      loading.value = false
    }
  }

  // Normalize date to YYYY-MM-DD string (uses shared utility for consistency)
  function normalizeToDateKey(date: Date | DateValue): string {
    // The shared helper accepts DateValueLike (year/month/day shape) — DateValue satisfies this.
    return sharedToDateKey(date as Parameters<typeof sharedToDateKey>[0])
  }

  // Get booked slots for a specific date (slot mode)
  // NOTE: The API returns duplicate slot IDs (one per booking), so this array
  // may contain the same slotId multiple times when capacity > 1
  function getBookedSlotsForDate(date: Date | DateValue): string[] {
    const dateKey = normalizeToDateKey(date)
    return availabilityData.value[dateKey]?.bookedSlots || []
  }

  // Clear availability data when location changes
  watch(locationId, () => {
    availabilityData.value = {}
  })

  return {
    // State
    loading,
    availabilityData,

    // Slots
    hasSlots,
    allSlots,
    locationSlots,
    fetchAvailability,
    getBookedSlotsForDate,
    normalizeToDateKey,

    // Schedule rules (pass-through)
    isDateUnavailable,
    isSlotAvailableByRules,
    getBlockedReason,
    getRuleBlockedSlotIds,

    // Constants
    ALL_DAY_SLOT,
  }
}
