<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { Booking, LocationData } from '../types/booking'
import { toDateKey } from '@fyit/crouton-core/shared/utils/date'
import { applyBookingToForm, editBookingBody, groupLabel, initialFormFromBooking } from '../utils/booking-form'
import { parseLocationProducts } from '../utils/capacity'
import { showProductPicker } from '../utils/product-picker'

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
  teamProducts,
  selectedLocation,
  allSlots,
  isSlotDisabled,
  getSlotRemaining,
  canAddToCart,
  addToCart,
  clearCart,
  toggleSlot,
  submitAll,
  isSubmitting,
  hasSlots,
  maxQuantity,
  availabilityLoading,
  // Group support
  enableGroups,
  groupOptions,
} = useBookingCart()

const notify = useNotify()
const { t } = useT()

const { locale } = useI18n()

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
const initialForm = initialFormFromBooking(props.booking)
const localLocationId = ref<string | null>(initialForm.locationId)
const localSlotIds = ref<string[]>(initialForm.slotIds)
const localGroupId = ref<string | null>(initialForm.groupId)

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
// (#3843) The form starts from the booking's saved values (incl. quantity),
// never from what an earlier form left in the shared state; a new booking
// starts at quantity 1. editingBookingId excludes the booking from availability.
watch(() => props.booking, (booking) => {
  const initial = applyBookingToForm(formState, booking)
  if (booking) {
    localLocationId.value = initial.locationId
    localSlotIds.value = initial.slotIds
    localGroupId.value = initial.groupId
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
  localGroupId.value = null
})

// Setup is done: the user's first location switch must reset the form too (#4331)
onMounted(() => {
  isInitialEditSetup.value = false
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

// === Products (#4112) ===
// The team's products give titles + the active flag; the location lists which it offers.
// They come from the cart, not awaited, so the card draws at once (#4314).
const { t: entityT } = useEntityTranslations()

type TeamProduct = { id: string, active?: boolean | null, title?: string }

const listedProducts = computed(() => {
  const team = (teamProducts.value ?? []) as TeamProduct[]
  const byId = new Map(team.filter(p => p.active !== false).map(p => [p.id, p]))
  return parseLocationProducts(selectedLocation.value?.products)
    .map(p => byId.get(p.product))
    .filter((p): p is TeamProduct => !!p)
})

const showPicker = computed(() =>
  !!selectedLocation.value && showProductPicker(selectedLocation.value, teamProducts.value as TeamProduct[]),
)

function productTitle(p: TeamProduct): string {
  return entityT(p, 'title') || p.id
}

// Never leave an amount that doesn't fit after a product or slot change
watch(maxQuantity, (m) => {
  if (m >= 1 && formState.quantity > m) formState.quantity = m
})

// Can submit
const canSubmit = computed(() => {
  // A new booking: product, slots/full day, an amount that fits, group, limit (#4110)
  if (!isEditMode.value) return canAddToCart.value

  if (!localLocationId.value) return false
  // If groups are enabled, require a group selection
  if (enableGroups.value && !localGroupId.value) return false
  if (hasSlots.value && localSlotIds.value.length === 0) return false
  return formState.quantity >= 1 && formState.quantity <= maxQuantity.value
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
        body: editBookingBody({
          locationId: localLocationId.value,
          slotIds: localSlotIds.value,
          groupId: localGroupId.value,
          date: toDateKey(props.date),
          productId: formState.productId,
          quantity: formState.quantity,
        }),
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

    <!-- Body: location tabs on top, content full width below (#4112) -->
    <div class="flex flex-col min-h-0">
        <!-- Location tabs: one row, scrolls sideways, never wraps; none with one location (#4471) -->
        <div v-if="(locations?.length ?? 0) > 1" class="border-b border-default px-1">
          <CroutonBookingsLocationTabs
            :locations="locations ?? []"
            :model-value="localLocationId"
            :is-disabled="id => !isLocationEnabled(id)"
            @update:model-value="v => localLocationId = v"
          />
        </div>

        <div class="p-4 flex flex-col gap-4">
          <!-- Location address -->
          <span v-if="selectedLocation && getLocationAddress(selectedLocation)" class="text-xs text-muted flex items-center gap-1">
            <UIcon name="i-lucide-map-pin" class="size-3 shrink-0" />
            {{ getLocationAddress(selectedLocation) }}
          </span>

          <!-- Product: buttons with 2+ products, plain text with one -->
          <div v-if="selectedLocation && listedProducts.length > 0" class="flex flex-col gap-1.5">
            <span class="text-sm font-medium text-default">{{ t('bookings.createCard.product') }}</span>
            <div v-if="showPicker" class="flex flex-wrap gap-1.5">
              <UButton
                v-for="p in listedProducts"
                :key="p.id"
                size="sm"
                :variant="formState.productId === p.id ? 'solid' : 'soft'"
                :color="formState.productId === p.id ? 'primary' : 'neutral'"
                @click="formState.productId = p.id"
              >
                {{ productTitle(p) }}
              </UButton>
            </div>
            <span v-else class="text-sm text-default">{{ productTitle(listedProducts[0]!) }}</span>
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
              {{ groupLabel(group, locale) }}
            </UButton>
          </div>

          <!-- Time: each slot shows the number free, e.g. 09:00 (3); (0) is greyed -->
          <div v-if="selectedLocation && hasSlots" class="flex flex-col gap-1.5">
            <span class="text-sm font-medium text-default">{{ t('bookings.createCard.time') }}</span>
            <div class="flex flex-wrap gap-1.5">
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
                  :color="localSlotIds.includes(slot.id) ? 'primary' : 'neutral'"
                  :disabled="isSlotDisabled(slot.id)"
                  @click="localSlotIds.includes(slot.id) ? localSlotIds = localSlotIds.filter(id => id !== slot.id) : localSlotIds = [...localSlotIds, slot.id]"
                >
                  <UIcon
                    v-if="localSlotIds.includes(slot.id)"
                    name="i-lucide-check"
                    class="size-3"
                  />
                  {{ slot.id === 'all-day' ? t('bookings.allDay') : (slot.label || slot.id) }} ({{ getSlotRemaining(slot.id) }})
                </UButton>
              </template>
            </div>
          </div>

          <!-- Amount: − booked/free +, + stops at the number free -->
          <div v-if="localLocationId" class="flex flex-col gap-1.5">
            <span class="text-sm font-medium text-default">{{ t('bookings.createCard.amount') }}</span>
            <div v-if="maxQuantity >= 1 || availabilityLoading" class="relative w-32">
              <UInputNumber
                v-model="formState.quantity"
                :min="1"
                :max="Math.max(1, maxQuantity)"
                :disabled="maxQuantity < 1"
                :aria-label="t('bookings.createCard.amountLabel', { booked: formState.quantity, free: maxQuantity })"
                variant="soft"
                size="sm"
                :ui="{ root: 'w-32', base: 'pe-14 text-end' }"
              />
              <span
                aria-hidden="true"
                class="pointer-events-none absolute inset-y-0 start-18 flex items-center text-xs text-muted"
              >/{{ maxQuantity }}</span>
            </div>
            <UBadge
              v-else
              color="neutral"
              variant="soft"
              size="sm"
              class="self-start"
            >
              {{ t('bookings.calendar.fullyBooked') }}
            </UBadge>
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
