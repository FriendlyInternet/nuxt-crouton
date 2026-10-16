import type { DateValue } from '@internationalized/date'
import type { BlockedDateItem, SlotSchedule, SlotItem, AvailabilityData } from '../types/booking'
import { ALL_DAY_SLOT } from '../types/booking'
import { withFullDay, isBlockedByFullDay } from '../utils/full-day'
import { parseLocationSlots } from './useBookingSlots'
import { toDateKey as sharedToDateKey } from '@fyit/crouton-core/shared/utils/date'

export type { AvailabilityData }

export interface InventoryAvailability {
  available: boolean
  remaining: number
  total: number
  bookedCount: number
}

export interface LocationWithInventory {
  id: string
  inventoryMode?: boolean
  /** Offer the built-in full day next to named slots (#2261) */
  offerFullDay?: boolean | null
  quantity?: number
  maxBookingsPerMonth?: number | null
  slots?: SlotItem[] | string | null
  // Schedule rule fields
  openDays?: number[] | string | null
  slotSchedule?: SlotSchedule | string | null
  blockedDates?: BlockedDateItem[] | string | null
}

/**
 * Composable for checking booking availability.
 * Supports both slot-based and inventory-based booking modes.
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

  // Check if location is in inventory mode
  const isInventoryMode = computed(() => location.value?.inventoryMode ?? false)

  // Total quantity for inventory mode
  const inventoryQuantity = computed(() => location.value?.quantity ?? 0)

  // All slots for slot mode — the full day when there are no named slots,
  // or next to them when the location offers it (#2261)
  const allSlots = computed<SlotItem[]>(() => {
    if (isInventoryMode.value) return []
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

  // Count how many times a slot is booked on a date (for capacity checking)
  function getSlotBookedCountForDate(date: Date | DateValue, slotId: string): number {
    const bookedSlots = getBookedSlotsForDate(date)
    return bookedSlots.filter(id => id === slotId).length
  }

  // Get remaining capacity for a slot on a date
  function getSlotRemainingForDate(date: Date | DateValue, slotId: string): number {
    const slot = allSlots.value.find(s => s.id === slotId)
    const capacity = slot?.capacity ?? 1
    const bookedCount = getSlotBookedCountForDate(date, slotId)
    return Math.max(0, capacity - bookedCount)
  }

  // Get booked count for a specific date (inventory mode)
  function getBookedCountForDate(date: Date | DateValue): number {
    const dateKey = normalizeToDateKey(date)
    return availabilityData.value[dateKey]?.bookedCount ?? 0
  }

  // Get inventory availability for a specific date
  // Optional quantityOverride for use in components that don't have location context
  function getInventoryAvailability(date: Date | DateValue, quantityOverride?: number): InventoryAvailability {
    const bookedCount = getBookedCountForDate(date)
    const total = quantityOverride ?? inventoryQuantity.value
    const remaining = Math.max(0, total - bookedCount)

    return {
      available: remaining > 0,
      remaining,
      total,
      bookedCount,
    }
  }

  // Get booked slot objects with labels for a specific date
  function getBookedSlotLabelsForDate(date: Date | DateValue): SlotItem[] {
    const bookedIds = getBookedSlotsForDate(date)
    return allSlots.value.filter(slot => bookedIds.includes(slot.id))
  }

  // Check if a date has any bookings
  function hasBookingsOnDate(date: Date | DateValue): boolean {
    if (isInventoryMode.value) {
      return getBookedCountForDate(date) > 0
    }
    return getBookedSlotsForDate(date).length > 0
  }

  // Check if a date is fully booked
  function isDateFullyBooked(date: Date | DateValue): boolean {
    if (isInventoryMode.value) {
      // Inventory mode: fully booked when all units are taken
      const { remaining } = getInventoryAvailability(date)
      return remaining === 0
    }

    // Slot mode: capacity-aware logic
    const bookedSlots = getBookedSlotsForDate(date)

    // If "all-day" is booked, the date is fully booked
    if (bookedSlots.includes('all-day')) {
      return true
    }

    // Fully booked when every offered slot is full or blocked by the full-day rule
    const offered = allSlots.value
    if (offered.length === 0) return false

    return offered.every((slot) => {
      const capacity = slot.capacity ?? 1
      const bookedCount = bookedSlots.filter(id => id === slot.id).length
      return bookedCount >= capacity || isBlockedByFullDay(slot.id, bookedSlots, [])
    })
  }

  // Get available slots for a specific date (slot mode only)
  function getAvailableSlotsForDate(date: Date | DateValue): SlotItem[] {
    if (isInventoryMode.value) return []

    // If date is completely unavailable by rules, no slots available
    if (isDateUnavailable(date)) return []

    const bookedSlots = getBookedSlotsForDate(date)
    const ruleBlockedSlots = getRuleBlockedSlotIds(date)

    // A rule-blocked slot counts as taken for the full-day rule (a full day
    // can't be booked when part of the day is closed)
    const taken = [...bookedSlots, ...ruleBlockedSlots]

    return allSlots.value.filter((slot) => {
      // Remove rule-blocked slots
      if (ruleBlockedSlots.includes(slot.id)) return false

      // Capacity-aware: slot is full when booked count >= capacity
      const capacity = slot.capacity ?? 1
      const bookedCount = bookedSlots.filter(id => id === slot.id).length
      if (bookedCount >= capacity) return false

      // Full day ⇄ other slots exclude each other
      return !isBlockedByFullDay(slot.id, taken, [])
    })
  }

  // Clear availability data when location changes
  watch(locationId, () => {
    availabilityData.value = {}
  })

  return {
    // State
    loading,
    availabilityData,

    // Mode detection
    isInventoryMode,
    inventoryQuantity,

    // Slot mode
    allSlots,
    locationSlots,
    fetchAvailability,
    getBookedSlotsForDate,
    getSlotBookedCountForDate,
    getSlotRemainingForDate,
    getBookedSlotLabelsForDate,
    getAvailableSlotsForDate,

    // Inventory mode
    getBookedCountForDate,
    getInventoryAvailability,

    // Both modes
    hasBookingsOnDate,
    isDateFullyBooked,
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
