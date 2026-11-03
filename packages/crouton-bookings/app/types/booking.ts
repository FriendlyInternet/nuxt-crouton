/**
 * Email statistics for a booking
 */
export interface EmailStats {
  total: number
  sent: number
  pending: number
  failed: number
}

/**
 * Detailed email status for a specific trigger type
 */
export interface EmailTriggerStatus {
  triggerType: EmailTriggerType
  status: 'sent' | 'pending' | 'failed' | 'not_sent'
  sentAt?: string | null
  /** For scheduled emails like reminders - when they will be sent */
  scheduledFor?: string | null
  /** Why the latest attempt failed (provider message), when it did */
  error?: string | null
  /** When the latest send attempt happened */
  attemptedAt?: string | null
}

/**
 * Email trigger types
 */
export type EmailTriggerType = 'booking_created' | 'reminder_before' | 'booking_cancelled' | 'follow_up_after'

/**
 * Available email action for resending
 */
export interface AvailableEmailAction {
  triggerType: EmailTriggerType
  label: string
  icon: string
}

export interface SlotItem {
  id: string
  label?: string
  value?: string
  color?: string
  capacity?: number
  translations?: {
    label?: Record<string, string>
  }
}

export interface BlockedDateItem {
  id: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD (inclusive)
  reason?: string // "Holiday", "Maintenance"
  blockedSlots?: string[] // empty = entire day; populated = only those slots
}

export type SlotSchedule = Record<string, number[]>

export interface LocationData {
  id: string
  teamId?: string
  owner?: string
  title: string
  color?: string | null
  street?: string | null
  zip?: string | null
  city?: string | null
  location?: string | null
  content?: string | null
  allowedMemberIds?: string | string[] | null
  slots?: SlotItem[] | string | null
  // Schedule rule fields
  openDays?: number[] | string | null
  slotSchedule?: SlotSchedule | string | null
  blockedDates?: BlockedDateItem[] | string | null
  /** Offer the built-in full day next to named slots (#2261) */
  offerFullDay?: boolean | null
  // Inventory mode fields
  inventoryMode?: boolean
  quantity?: number
  // Monthly booking limit
  maxBookingsPerMonth?: number | null
  // Translations for i18n support
  translations?: Record<string, { title?: string; street?: string; zip?: string; city?: string; content?: string }>
  createdAt?: string | Date
  updatedAt?: string | Date
  createdBy?: string
  updatedBy?: string
}

export interface UserInfo {
  id: string
  name: string
  email: string
  avatarUrl?: string | null
}

export interface CartItem {
  id: string
  locationId: string
  locationTitle: string
  date: Date | string
  slotIds: string[]
  slotLabels: string[]
  slotColor?: string
  slotPosition?: number
  totalSlots?: number
  groupId?: string | null
  groupLabel?: string | null
  // Inventory mode
  isInventoryMode?: boolean
  quantity?: number
}

export interface SettingsData {
  id: string
  teamId: string
  enableGroups?: boolean
  groups?: Array<{ id: string; label: string }>
  statuses?: Array<{ id: string; label: string; color?: string }>
}

export interface BookingData {
  id: string
  teamId: string
  locationId: string
  date: string | Date
  slot: string
  status: string
  owner?: string
  createdAt?: string | Date
  updatedAt?: string | Date
}

/**
 * Availability data from the API, keyed by date (YYYY-MM-DD).
 * Shared between useBookingAvailability and useBookingCart.
 */
export interface AvailabilityData {
  [dateISO: string]: {
    bookedSlots: string[]
    bookedCount?: number // For inventory mode
    bookedGroupSlots?: Record<string, string[]> // slotId → groupIds that booked it
  }
}

/** Sentinel slot used when a location has no named slots */
export const ALL_DAY_SLOT: SlotItem = {
  id: 'all-day',
  label: 'All Day',
}

/**
 * Booking with related data from API
 */
export interface Booking {
  id: string
  teamId: string
  location: string // locationId
  date: string | Date
  slot: string // JSON-encoded array: '["slot-1"]'
  quantity?: number
  group?: string | null
  status: string
  owner?: string | null
  createdAt: string | Date
  updatedAt?: string | Date
  createdBy?: string | null
  updatedBy?: string | null
  // Related data from joins
  locationData?: LocationData | null
  ownerUser?: UserInfo | null
  createdByUser?: UserInfo | null
  // Email data (when email module is enabled)
  emailStats?: EmailStats | null
  emailActions?: AvailableEmailAction[]
  /** Detailed status per email trigger type */
  emailDetails?: EmailTriggerStatus[]
}
