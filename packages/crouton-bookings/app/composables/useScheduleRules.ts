import type { DateValue } from '@internationalized/date'
import type { BlockedDateItem, SlotSchedule, SlotItem } from '../types/booking'
import { parseLocationSlots } from './useBookingSlots'
import { toDateKey as sharedToDateKey } from '@fyit/crouton-core/shared/utils/date'

/** Minimal interface for schedule rule evaluation */
interface ScheduleRuleLocation {
  openDays?: number[] | string | null
  slotSchedule?: SlotSchedule | string | null
  blockedDates?: BlockedDateItem[] | string | null
  slots?: SlotItem[] | string | null
}

/**
 * Composable for evaluating location schedule rules (open days, slot schedules, blocked dates).
 * Pure client-side evaluation — no API calls. All data comes from the location object.
 *
 * Precedence (all must pass for a slot to be available):
 * 1. Location open on this weekday → openDays
 * 2. Slot scheduled for this weekday → slotSchedule (falls back to openDays)
 * 3. Date not in a blocked range, or slot not in blockedSlots → blockedDates
 */
export function useScheduleRules(location: Ref<ScheduleRuleLocation | null | undefined>) {
  const { t } = useT()
  // --- Field parsers ---

  const openDays = computed<number[] | null>(() => {
    const raw = location.value?.openDays
    if (raw == null) return null
    if (Array.isArray(raw)) return raw.length === 0 ? null : raw
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
      } catch {
        return null
      }
    }
    return null
  })

  const slotSchedule = computed<SlotSchedule | null>(() => {
    const raw = location.value?.slotSchedule
    if (raw == null) return null
    if (typeof raw === 'object' && !Array.isArray(raw) && typeof raw !== 'string') {
      return Object.keys(raw).length > 0 ? raw as SlotSchedule : null
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return Object.keys(parsed).length > 0 ? parsed : null
        }
      } catch {
        return null
      }
    }
    return null
  })

  const blockedDates = computed<BlockedDateItem[]>(() => {
    const raw = location.value?.blockedDates
    if (raw == null) return []
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    return []
  })

  // Parse location slots for "all day" rule evaluation — uses shared utility
  const locationSlots = computed<SlotItem[]>(() => parseLocationSlots(location.value))

  // --- Helpers ---

  /** Normalize Date or DateValue to YYYY-MM-DD key (delegates to shared utility) */
  function toDateKey(date: Date | DateValue): string {
    return sharedToDateKey(date as Parameters<typeof sharedToDateKey>[0])
  }

  /** Get JS day-of-week (0=Sun, 6=Sat) from Date or DateValue */
  function getDayOfWeek(date: Date | DateValue): number {
    if (date instanceof Date) return date.getDay()
    // DateValue: construct a temp Date to get day of week
    return new Date(date.year, date.month - 1, date.day).getDay()
  }

  // --- Rule checks ---

  /**
   * Check if the location is open on the given date's day-of-week.
   * Returns true if openDays is null/empty (all days open).
   */
  function isLocationOpenOnDate(date: Date | DateValue): boolean {
    if (!openDays.value) return true // null = all days open
    return openDays.value.includes(getDayOfWeek(date))
  }

  /**
   * Check if a date falls within any blocked date range.
   * Optionally checks if a specific slot is blocked (if blockedSlots is set).
   * When slotId is not provided, returns true if the entire day is blocked.
   */
  function isDateBlocked(date: Date | DateValue, slotId?: string): boolean {
    if (blockedDates.value.length === 0) return false

    const dateKey = toDateKey(date)

    for (const blocked of blockedDates.value) {
      if (!blocked.startDate || !blocked.endDate) continue

      // Inclusive range check
      if (dateKey >= blocked.startDate && dateKey <= blocked.endDate) {
        // If no blockedSlots specified, entire day is blocked
        if (!blocked.blockedSlots || blocked.blockedSlots.length === 0) {
          return true
        }
        // If slotId provided, check if it's in the blocked list
        if (slotId) {
          if (blocked.blockedSlots.includes(slotId)) return true
        } else {
          // No slotId provided — day is only "fully blocked" if no slot restriction
          // (already handled above: blockedSlots is empty)
          continue
        }
      }
    }

    return false
  }

  /**
   * Check if a date is completely unavailable (not bookable at all).
   * Combines openDays + blockedDates (entire-day blocks only).
   */
  function isDateUnavailable(date: Date | DateValue): boolean {
    // Not open this day of week
    if (!isLocationOpenOnDate(date)) return true

    // Entire-day blocked
    if (isDateBlocked(date)) return true

    return false
  }

  /**
   * Full availability check for a specific slot on a specific date.
   * Checks: openDays → slotSchedule → blockedDates
   */
  function isSlotAvailableByRules(slotId: string, date: Date | DateValue): boolean {
    // 1. Location must be open on this day
    if (!isLocationOpenOnDate(date)) return false

    // 2. Check slot schedule (per-slot day-of-week map)
    const schedule = slotSchedule.value
    if (schedule && slotId !== 'all-day') {
      const slotDays = schedule[slotId]
      if (slotDays) {
        // Slot has explicit schedule — must include this day
        if (!slotDays.includes(getDayOfWeek(date))) return false
      }
      // No entry for this slot → falls back to openDays (already checked)
    }

    // 3. Check blocked dates
    if (isDateBlocked(date, slotId)) return false

    return true
  }

  /**
   * Get reason string for why a date is unavailable (for tooltips).
   * Returns null if date is available.
   */
  function getBlockedReason(date: Date | DateValue): string | null {
    if (!isLocationOpenOnDate(date)) return t('bookings.calendar.closed')

    const dateKey = toDateKey(date)
    for (const blocked of blockedDates.value) {
      if (!blocked.startDate || !blocked.endDate) continue
      if (dateKey >= blocked.startDate && dateKey <= blocked.endDate) {
        if (!blocked.blockedSlots || blocked.blockedSlots.length === 0) {
          return blocked.reason || t('bookings.calendar.blocked')
        }
      }
    }

    return null
  }

  /**
   * Get all slot IDs that are blocked by schedule rules on a given date.
   * Used to pass as disabledSlotIds to SlotPicker.
   */
  function getRuleBlockedSlotIds(date: Date | DateValue): string[] {
    const blocked: string[] = []

    for (const slot of locationSlots.value) {
      if (!isSlotAvailableByRules(slot.id, date)) {
        blocked.push(slot.id)
      }
    }

    // "All Day" rule: if any individual slot is rule-blocked, all-day is also blocked
    if (blocked.length > 0) {
      blocked.push('all-day')
    }

    return blocked
  }

  return {
    // Parsed fields (reactive)
    openDays,
    slotSchedule,
    blockedDates,

    // Rule checks
    isLocationOpenOnDate,
    isDateBlocked,
    isDateUnavailable,
    isSlotAvailableByRules,
    getBlockedReason,
    getRuleBlockedSlotIds,
  }
}
