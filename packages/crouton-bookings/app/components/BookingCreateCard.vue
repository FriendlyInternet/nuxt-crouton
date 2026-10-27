<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Booking, LocationData } from '../types/booking'
import { toDateKey } from '@fyit/crouton-core/shared/utils/date'

interface Props {
  /** The date for this booking */
  date: Date
  /** Active location filter - if set, only these locations are selectable */
  activeLocationFilter?: string[]
  /** Existing booking to edit (if provided, component is in edit mode) */
  booking?: Booking
}

const props = withDefaults(defineProps<Props>(), {
  activeLocationFilter: undefined,
  booking: undefined,
})

const emit = defineEmits<{
  created: []
  updated: []
  cancel: []
  cancelled: []
}>()

// Are we in edit mode?
const isEditMode = computed(() => !!props.booking)

const {
  formState,
  locations,
  locationsStatus,
  selectedLocation,
  allSlots,
  isSlotDisabled,
  isSlotTaken,
  getSlotRemaining,
  getSlotCapacity,
  canAddToCart,
  addToCart,
  clearCart,
  toggleSlot,
  submitAll,
  isSubmitting,
  isInventoryMode,
  getInventoryAvailability,
  availabilityLoading,
  // Group support
  enableGroups,
  groupOptions,
} = useBookingCart()

const notify = useNotify()
const { t } = useT()

// For parsing slot JSON strings
const { parseSlotIds } = useBookingSlots()
const { locale } = useI18n()

// Helper to extract all slot IDs from booking slot (which is JSON string like '["matin","apres-midi"]')
function getSlotIdsFromBooking(slot: string | null | undefined): string[] {
  if (!slot) return []
  return parseSlotIds(slot)
}

// Get localized location title with fallbacks
function getLocationTitle(location: LocationData): string {
  const translations = location.translations as Record<string, { title?: string }> | undefined

  return translations?.[locale.value]?.title
    || translations?.en?.title
    || location.title
    || t('bookings.untitled')
}

// Get localized location content/description
function getLocationContent(location: LocationData): string | null {
  const translations = location.translations as Record<string, { content?: string }> | undefined

  return translations?.[locale.value]?.content
    || translations?.en?.content
    || location.content
    || null
}

// Get location address line
function getLocationAddress(location: LocationData): string | null {
  const translations = location.translations as Record<string, { street?: string; city?: string }> | undefined
  const street = translations?.[locale.value]?.street || translations?.en?.street || location.street
  const city = translations?.[locale.value]?.city || translations?.en?.city || location.city

  if (!street && !city) return null
  return [street, city].filter(Boolean).join(', ')
}

// Local state - initialize from booking if in edit mode
const localLocationId = ref<string | null>(props.booking?.location ?? null)
const localSlotIds = ref<string[]>(getSlotIdsFromBooking(props.booking?.slot))
const localGroupId = ref<string | null>(props.booking?.group ?? null)

// Track if we're updating
const isUpdating = ref(false)

// Track if we're cancelling the booking
const isCancelling = ref(false)

// Track if we're in initial edit mode setup (to prevent clearing slot)
const isInitialEditSetup = ref(!!props.booking)

// Team ID from auth context
const { currentTeam } = useTeam()
const teamId = computed(() => currentTeam.value?.id)

// Sync form state when component mounts or date changes
watch(() => props.date, (newDate) => {
  formState.date = newDate
  formState.locationId = localLocationId.value
  formState.slotIds = localSlotIds.value
  formState.groupId = localGroupId.value
}, { immediate: true })

// Initialize from booking when entering edit mode
watch(() => props.booking, (booking) => {
  if (booking) {
    // Set editing booking ID to exclude from availability check
    formState.editingBookingId = booking.id
    localLocationId.value = booking.location
    localSlotIds.value = getSlotIdsFromBooking(booking.slot)
    localGroupId.value = booking.group ?? null
  } else {
    // Clear editing state when not in edit mode
    formState.editingBookingId = null
  }
}, { immediate: true })

// Sync local location to form state
watch(localLocationId, (v) => {
  formState.locationId = v
  // Don't clear slots during initial edit mode setup
  if (isInitialEditSetup.value) {
    isInitialEditSetup.value = false
    return
  }
  localSlotIds.value = []
  formState.slotIds = []
})

// Sync local slots to form state
watch(localSlotIds, (v) => {
  formState.slotIds = v
}, { deep: true })

// Sync local group to form state and remove slots that become unavailable for this group
watch(localGroupId, (v) => {
  formState.groupId = v
  // Remove any selected slots that are now disabled for the new group
  const validSlots = localSlotIds.value.filter(id => !isSlotDisabled(id))
  if (validSlots.length !== localSlotIds.value.length) {
    localSlotIds.value = validSlots
    formState.slotIds = validSlots
  }
})

// Auto-select first enabled location
watch(
  [() => locations.value, () => props.activeLocationFilter],
  ([locs, filter]: [LocationData[] | undefined, string[] | undefined]) => {
    if (locs && locs.length > 0 && !localLocationId.value) {
      // Find first enabled location
      const firstEnabled = locs.find((loc: LocationData) => {
        if (!filter || filter.length === 0) return true
        return filter.includes(loc.id)
      })
      if (firstEnabled) {
        localLocationId.value = firstEnabled.id
      }
    }
    // If current selection becomes disabled, clear it
    if (localLocationId.value && filter && filter.length > 0) {
      if (!filter.includes(localLocationId.value)) {
        // Find first enabled location to switch to
        const firstEnabled = locs?.find((loc: LocationData) => filter.includes(loc.id))
        localLocationId.value = firstEnabled?.id || null
      }
    }
  },
  { immediate: true },
)

// Get inventory info for selected date
const inventoryInfo = computed(() => {
  if (!isInventoryMode.value) return null
  return getInventoryAvailability(props.date)
})

// Can submit
const canSubmit = computed(() => {
  if (!localLocationId.value) return false

  // If groups are enabled, require a group selection
  if (enableGroups.value && !localGroupId.value) return false

  if (isInventoryMode.value) {
    return inventoryInfo.value?.available ?? false
  } else {
    return localSlotIds.value.length > 0
  }
})

// Handle create or update
async function handleSubmit() {
  if (!canSubmit.value) return

  if (isEditMode.value && props.booking) {
    // Update existing booking
    isUpdating.value = true
    try {
      await $fetch(`/api/crouton-bookings/teams/${teamId.value}/bookings/${props.booking.id}`, {
        method: 'PATCH',
        body: {
          location: localLocationId.value,
          // Slot is stored as JSON array string in DB
          slot: localSlotIds.value.length > 0 ? JSON.stringify(localSlotIds.value) : null,
          group: localGroupId.value,
          date: toDateKey(props.date),
        },
      })
      // Clear editing state
      formState.editingBookingId = null
      emit('updated')
    } catch (error) {
      console.error('Failed to update booking:', error)
    } finally {
      isUpdating.value = false
    }
  } else {
    // Create new booking — clear any stale cart items first so only this booking is submitted
    clearCart()
    addToCart()
    const result = await submitAll()
    if (result) {
      emit('created')
    }
  }
}

// Format date for display
const formattedDate = computed(() => {
  return new Intl.DateTimeFormat(locale.value, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(props.date)
})

// Check if a location is enabled based on active filter
function isLocationEnabled(locationId: string): boolean {
  // If no filter is set, all locations are enabled
  if (!props.activeLocationFilter || props.activeLocationFilter.length === 0) {
    return true
  }
  // Only locations in the active filter are enabled
  return props.activeLocationFilter.includes(locationId)
}

// Handle cancel - clear editing state
function handleCancel() {
  formState.editingBookingId = null
  emit('cancel')
}

// Handle cancel booking
async function cancelBooking() {
  if (!props.booking || !teamId.value) return

  isCancelling.value = true
  try {
    await $fetch(`/api/crouton-bookings/teams/${teamId.value}/bookings/${props.booking.id}`, {
      method: 'PATCH',
      body: {
        status: 'cancelled',
      },
    })
    formState.editingBookingId = null
    emit('cancelled')
  } catch (error) {
    console.error('Failed to cancel booking:', error)
  } finally {
    isCancelling.value = false
  }
}

// Check if booking is already cancelled
const isAlreadyCancelled = computed(() => props.booking?.status === 'cancelled')
</script>

<template>
  <UCard
    variant="outline"
    :ui="{
      root: 'ring-2 ring-primary/40 bg-primary/5 shadow-lg shadow-primary/10',
      header: 'px-3 py-2.5 sm:px-3 bg-primary/10',
      body: 'p-0 sm:p-0',
    }"
  >
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <UIcon :name="isEditMode ? 'i-lucide-pencil' : 'i-lucide-calendar-plus'" class="size-4 text-primary" />
          <span class="text-sm font-semibold text-primary">{{ isEditMode ? t('bookings.createCard.editBookingFor') : t('bookings.createCard.newBookingFor') }} {{ formattedDate }}</span>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="handleCancel"
        />
      </div>
    </template>

    <!-- Body: locations sidebar + content -->
    <div class="flex min-h-0">
        <!-- Location sidebar -->
        <div class="w-52 shrink-0 border-r border-default flex flex-col gap-0.5 px-1 py-4">
          <UButton
            v-for="location in locations"
            :key="location.id"
            size="sm"
            :variant="localLocationId === location.id ? 'soft' : 'ghost'"
            :color="localLocationId === location.id ? 'primary' : 'neutral'"
            :disabled="!isLocationEnabled(location.id)"
            block
            class="justify-start"
            :class="!isLocationEnabled(location.id) && 'opacity-40'"
            @click="localLocationId = location.id"
          >
            <span
              class="w-2 h-2 rounded-full shrink-0"
              :style="{ backgroundColor: isLocationEnabled(location.id) ? (location.color || '#3b82f6') : '#9ca3af' }"
            />
            <span class="text-left break-words">{{ getLocationTitle(location) }}</span>
          </UButton>
        </div>

        <!-- Right content -->
        <div class="flex-1 p-4 flex flex-col gap-4">
          <!-- Location info + prompt -->
          <div v-if="selectedLocation" class="flex flex-col gap-2">
            <span v-if="getLocationAddress(selectedLocation)" class="text-xs text-muted flex items-center gap-1">
              <UIcon name="i-lucide-map-pin" class="size-3 shrink-0" />
              {{ getLocationAddress(selectedLocation) }}
            </span>
            <span class="text-sm font-medium text-default">
              {{ isInventoryMode ? t('bookings.createCard.howMany') : t('bookings.createCard.pickTimeSlot') }}
            </span>
          </div>

          <!-- Group selection (when groups are enabled) -->
          <div v-if="enableGroups && groupOptions.length > 0" class="flex flex-wrap gap-1.5">
            <UButton
              v-for="group in groupOptions"
              :key="group.id"
              size="xs"
              :variant="localGroupId === group.id ? 'solid' : 'soft'"
              :color="localGroupId === group.id ? 'primary' : 'neutral'"
              @click="localGroupId = group.id"
            >
              {{ group.label }}
            </UButton>
          </div>

          <!-- Slot selection (slot mode) -->
          <div v-if="selectedLocation && !isInventoryMode" class="flex flex-wrap gap-1.5">
            <!-- Loading state -->
            <template v-if="availabilityLoading">
              <div v-for="i in 3" :key="i" class="h-6 w-16 bg-elevated rounded animate-pulse" />
            </template>

            <!-- Slots -->
            <template v-else>
              <UButton
                v-for="slot in allSlots"
                :key="slot.id"
                size="sm"
                :variant="localSlotIds.includes(slot.id) ? 'solid' : 'soft'"
                :color="localSlotIds.includes(slot.id) ? 'primary' : (isSlotTaken(slot.id) ? 'error' : 'neutral')"
                :disabled="isSlotDisabled(slot.id)"
                @click="localSlotIds.includes(slot.id) ? localSlotIds = localSlotIds.filter(id => id !== slot.id) : localSlotIds = [...localSlotIds, slot.id]"
              >
                <UIcon
                  v-if="localSlotIds.includes(slot.id)"
                  name="i-lucide-check"
                  class="size-3"
                />
                <span :class="{ 'line-through': isSlotTaken(slot.id) }">
                  {{ slot.id === 'all-day' ? t('bookings.allDay') : (slot.label || slot.id) }}
                </span>
                <span v-if="getSlotCapacity(slot.id) > 1 && !isSlotDisabled(slot.id)" class="text-xs opacity-60 ml-0.5">
                  ({{ getSlotRemaining(slot.id) }} {{ t('bookings.createCard.left') }})
                </span>
                <UIcon
                  v-if="isSlotTaken(slot.id)"
                  name="i-lucide-ban"
                  class="size-3 ml-0.5"
                />
              </UButton>
            </template>
          </div>

          <!-- Inventory mode: quantity selector + availability -->
          <div v-if="localLocationId && isInventoryMode && inventoryInfo" class="flex items-center gap-3">
            <UInputNumber
              v-model="formState.quantity"
              :min="1"
              :max="inventoryInfo.remaining"
              :disabled="!inventoryInfo.available"
              variant="soft"
              size="sm"
              :ui="{ root: 'w-28' }"
            />
            <span class="text-sm text-muted">
              {{ t('bookings.createCard.ofAvailable', { count: inventoryInfo.remaining }) }}
            </span>
          </div>

          <!-- No location selected -->
          <div v-if="!localLocationId" class="text-sm text-muted py-2">
            {{ t('bookings.createCard.selectLocation') }}
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-2 mt-auto">
            <!-- Cancel booking (two-click confirm) -->
            <CroutonConfirmButton
              v-if="isEditMode && !isAlreadyCancelled"
              :label="t('bookings.createCard.cancel')"
              :confirm-label="t('bookings.createCard.sure')"
              icon="i-lucide-x-circle"
              :loading="isCancelling"
              @confirm="cancelBooking"
            />

            <UButton
              color="primary"
              size="xs"
              :disabled="!canSubmit || isSubmitting || isUpdating || isAlreadyCancelled"
              :loading="isSubmitting || isUpdating"
              @click="handleSubmit"
            >
              {{ isEditMode ? t('bookings.createCard.save') : t('bookings.createCard.create') }}
            </UButton>
          </div>
        </div>
      </div>
  </UCard>
</template>
