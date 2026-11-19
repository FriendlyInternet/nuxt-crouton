<script setup lang="ts">
import type { Booking } from '../../types/booking'

interface SlotItem {
  id: string
  label?: string
  color?: string
}

interface Props {
  slots: SlotItem[]
  bookedSlotIds?: string[]
  /** Slot IDs with some bookings but not at full capacity */
  partialSlotIds?: string[]
  /** Slot IDs that belong to cancelled bookings (shown in red) */
  cancelledSlotIds?: string[]
  /** Bookings data for hover highlighting */
  bookings?: Booking[]
  /** Color to use for unfilled slots and booked slots (from location) */
  color?: string
  /** Optional override color for booked slots (e.g., red for cancelled) */
  bookedColor?: string
  /** Color for cancelled slots */
  cancelledColor?: string
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg'
  /** 'dots' = fixed-size circles, 'bars' = flex-grow to fill width */
  variant?: 'dots' | 'bars'
}

const props = withDefaults(defineProps<Props>(), {
  bookedSlotIds: () => [],
  partialSlotIds: () => [],
  cancelledSlotIds: () => [],
  bookings: () => [],
  color: '#3b82f6',
  bookedColor: undefined,
  cancelledColor: '#ef4444',
  size: 'md',
  variant: 'bars',
})

const emit = defineEmits<{
  /** Emitted when hovering over a booked slot, with the booking ID */
  hoverBooking: [bookingId: string | null]
}>()

const { parseSlotIds } = useBookingSlots()

const dotSizeClasses = {
  '2xs': 'size-1',
  xs: 'size-1.5',
  sm: 'size-2',
  md: 'size-3',
  lg: 'size-4',
}

const barHeightClasses = {
  '2xs': 'h-1',
  xs: 'h-1.5',
  sm: 'h-2',
  md: 'h-2.5',
  lg: 'h-3',
}

const gapClasses = {
  '2xs': 'gap-px',
  xs: 'gap-[2px]',
  sm: 'gap-[3px]',
  md: 'gap-1',
  lg: 'gap-1.5',
}

function isBooked(slotId: string): boolean {
  return props.bookedSlotIds?.includes(slotId) || false
}

function isPartial(slotId: string): boolean {
  return props.partialSlotIds?.includes(slotId) || false
}

function isCancelled(slotId: string): boolean {
  return props.cancelledSlotIds?.includes(slotId) || false
}

// Three shades: full (1.0), partly booked (0.5), empty (faint) — so a
// half-full slot no longer looks the same as an empty one (#3046)
function getSlotOpacity(slotId: string): number {
  if (isBooked(slotId)) return 1
  if (isPartial(slotId)) return 0.5
  return 0.1
}

function getSlotColor(slotId: string): string {
  if (isCancelled(slotId) && isBooked(slotId)) return props.cancelledColor
  // Use per-slot color if available, then bookedColor override, then location color
  const slot = props.slots.find(s => s.id === slotId)
  const slotColor = slot?.color || props.color
  if (isBooked(slotId)) return props.bookedColor || slotColor
  return slotColor
}

// Get booking for a specific slot
function getBookingForSlot(slotId: string): Booking | undefined {
  return props.bookings?.find((booking) => {
    const slotIds = parseSlotIds(booking.slot)
    return slotIds.includes(slotId) || slotIds.includes('all-day')
  })
}

// Handle hover on a slot
function onSlotHover(slotId: string) {
  const booking = getBookingForSlot(slotId)
  emit('hoverBooking', booking?.id ?? null)
}

function onSlotLeave() {
  emit('hoverBooking', null)
}
</script>

<template>
  <div
    class="flex"
    :class="[
      gapClasses[size],
      variant === 'bars' ? 'w-full' : 'justify-center',
    ]"
  >
    <div
      v-for="slot in slots"
      :key="slot.id"
      class="rounded-full transition-colors"
      :class="[
        variant === 'dots' ? dotSizeClasses[size] : ['flex-1', barHeightClasses[size]],
        (isBooked(slot.id) || isPartial(slot.id)) ? 'cursor-pointer' : '',
      ]"
      :style="{
        backgroundColor: getSlotColor(slot.id),
        opacity: getSlotOpacity(slot.id),
      }"
      :title="slot.label"
      @mouseenter="(isBooked(slot.id) || isPartial(slot.id)) && onSlotHover(slot.id)"
      @mouseleave="onSlotLeave"
    />
  </div>
</template>
