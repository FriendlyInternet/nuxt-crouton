<!--
  CroutonBookingsLocationForm
  Package-provided form for the bookings locations collection.
  Replaces the CLI-generated _Form.vue with a polished 3-tab layout.

  Maps integration is optional — works with or without @fyit/crouton-maps.
  When maps is installed: shows interactive map with geocoding.
  When maps is absent: shows address fields only.
-->

<template>
  <CroutonFormActionButton
    v-if="action === 'delete'"
    :action="action"
    :collection="collection"
    :items="items"
    :loading="loading"
    @click="handleSubmit"
  />

  <UForm
    v-else
    :schema="schema"
    :state="state"
    @submit="handleSubmit"
    @error="handleValidationError"
  >
    <CroutonFormLayout :tabs="tabs" :navigation-items="navigationItems" :tab-errors="tabErrorCounts" v-model="activeSection">
      <template #main="{ activeSection }">
        <!-- Location -->
        <div v-show="activeSection === 'location'" class="flex flex-col gap-6 p-1">
          <fieldset class="flex flex-col gap-4">
            <legend class="text-sm font-semibold text-gray-900 dark:text-white mb-1">{{ t('bookings.locationForm.locationDetails') }}</legend>
            <p class="text-sm text-gray-500 -mt-1">{{ t('bookings.locationForm.colorHint') }}</p>
            <UFormField :label="t('bookings.locationForm.color')" name="color">
              <CroutonFormColorPicker v-model="(state.color as any)" />
            </UFormField>
          </fieldset>

          <USeparator />

          <!-- Address & Map -->
          <fieldset class="flex flex-col gap-4">
            <legend class="text-sm font-semibold text-gray-900 dark:text-white mb-1">{{ t('bookings.locationForm.address') }}</legend>
            <p class="text-sm text-gray-500 -mt-1">
              {{ hasMaps ? t('bookings.locationForm.addressHintWithMap') : t('bookings.locationForm.addressHint') }}
            </p>
            <UFormField :label="t('bookings.locationForm.street')" name="street">
              <UInput v-model="(state.street as any)" class="w-full" />
            </UFormField>
            <div class="grid grid-cols-2 gap-4">
              <UFormField :label="t('bookings.locationForm.zipCode')" name="zip">
                <UInput v-model="(state.zip as any)" class="w-full" />
              </UFormField>
              <UFormField :label="t('bookings.locationForm.city')" name="city">
                <UInput v-model="(state.city as any)" class="w-full" />
              </UFormField>
            </div>
            <UFormField v-if="hasMaps" :label="t('bookings.locationForm.locationMap')" name="location">
              <CroutonMapsMap
                :center="mapCenter"
                :zoom="14"
                height="400px"
                class="rounded-lg border"
                :fly-to-on-center-change="true"
                @load="handleMapLoad"
              >
                <template #default="{ map }">
                  <CroutonMapsMarker
                    v-if="mapCenter[0] !== 0 || mapCenter[1] !== 0"
                    :map="(map as any)"
                    :position="mapCenter"
                    :color="markerColor"
                    :options="{ draggable: true }"
                    :animate-transitions="true"
                    @dragEnd="handleMarkerDragEnd"
                  />
                </template>
              </CroutonMapsMap>
              <p v-if="geocoding" class="text-sm text-gray-500 mt-2">
                {{ t('bookings.locationForm.geocoding') }}
              </p>
            </UFormField>
          </fieldset>
        </div>

        <!-- Settings -->
        <div v-show="activeSection === 'settings'" class="flex flex-col gap-6 p-1">
          <!-- Access Control -->
          <fieldset class="flex flex-col gap-4">
            <legend class="text-sm font-semibold text-gray-900 dark:text-white mb-1">{{ t('bookings.locationForm.accessControl') }}</legend>
            <p class="text-sm text-gray-500 -mt-1">{{ t('bookings.locationForm.accessControlHint') }}</p>
            <UFormField :label="t('bookings.locationForm.allowedMembers')" name="allowedMemberIds">
              <USelectMenu
                v-model="(state.allowedMemberIds as any)"
                :items="memberItems"
                multiple
                value-key="value"
                :loading="membersLoading"
                icon="i-lucide-users"
                :placeholder="t('bookings.locationForm.allTeamMembers')"
                class="w-full"
                :filter-fields="['label', 'email']"
              >
                <template #item-label="{ item }">
                  {{ item.label }}
                  <span class="text-muted">{{ item.email }}</span>
                </template>
              </USelectMenu>
            </UFormField>
          </fieldset>
        </div>

        <!-- Bookings -->
        <div v-show="activeSection === 'bookings'" class="flex flex-col gap-6 p-1">
          <fieldset class="flex flex-col gap-4">
            <legend class="text-sm font-semibold text-gray-900 dark:text-white mb-1">{{ t('bookings.locationForm.bookingRules') }}</legend>
            <p class="text-sm text-gray-500 -mt-1">{{ t('bookings.locationForm.bookingRulesHint') }}</p>
            <UFormField :label="t('bookings.locationForm.bookingMode')" name="inventoryMode">
              <URadioGroup
                :model-value="state.inventoryMode ? 'inventory' : 'slots'"
                orientation="horizontal"
                variant="card"
                :items="[
                  { label: t('bookings.locationForm.timeSlots'), description: t('bookings.locationForm.timeSlotsDescription'), value: 'slots' },
                  { label: t('bookings.locationForm.inventory'), description: t('bookings.locationForm.inventoryDescription'), value: 'inventory' },
                ]"
                @update:model-value="(v: string) => state.inventoryMode = v === 'inventory'"
              />
            </UFormField>
            <UFormField v-show="state.inventoryMode" :label="t('bookings.locationForm.availableUnits')" name="quantity" :help="t('bookings.locationForm.availableUnitsHelp')">
              <UInputNumber v-model="state.quantity" class="w-full" />
            </UFormField>
            <UFormField :label="t('bookings.locationForm.maxBookingsPerMonth')" name="maxBookingsPerMonth" :help="t('bookings.locationForm.maxBookingsPerMonthHelp')">
              <UInputNumber v-model="state.maxBookingsPerMonth" class="w-full" :min="0" :placeholder="t('bookings.locationForm.unlimited')" />
            </UFormField>
          </fieldset>

          <USeparator />

          <fieldset class="flex flex-col gap-4">
            <legend class="text-sm font-semibold text-gray-900 dark:text-white mb-1">{{ t('bookings.locationForm.scheduling') }}</legend>
            <p class="text-sm text-gray-500 -mt-1">{{ t('bookings.locationForm.schedulingHint') }}</p>
            <UFormField v-if="!state.inventoryMode" :label="t('bookings.locationForm.slots')" name="slots">
              <CroutonFormRepeater
                v-model="(state.slots as any)"
                component-name="BookingsLocationsSlotInput"
                :add-label="$t('bookings.locationForm.addTimeSlot')"
                :sortable="true"
              />
            </UFormField>
            <UFormField
              v-if="!state.inventoryMode && state.slots?.length"
              name="offerFullDay"
            >
              <USwitch
                v-model="(state.offerFullDay as any)"
                :label="t('bookings.locationForm.offerFullDay')"
                :description="t('bookings.locationForm.offerFullDayHint')"
              />
            </UFormField>
            <UFormField :label="t('bookings.schedule.openDays')" name="openDays">
              <CroutonBookingsOpenDaysPicker v-model="state.openDays" />
            </UFormField>
            <UFormField v-if="!state.inventoryMode && state.slots?.length" :label="t('bookings.schedule.slotSchedule')" name="slotSchedule">
              <CroutonBookingsScheduleGrid v-model="state.slotSchedule" :slots="state.slots" :open-days="state.openDays" />
            </UFormField>
            <UFormField :label="t('bookings.schedule.blockedDates')" name="blockedDates">
              <CroutonFormRepeater
                v-model="(state.blockedDates as any)"
                component-name="CroutonBookingsBlockedDateInput"
                :add-label="$t('bookings.schedule.addBlockedPeriod')"
                :sortable="false"
              />
            </UFormField>
          </fieldset>
        </div>

        <!-- Content -->
        <div v-show="activeSection === 'content'" class="flex flex-col gap-4 p-1">
          <CroutonI18nInput
            v-model="(state.translations as any)"
            :fields="['title', 'content']"
            :default-values="{
              title: state.title || '',
              content: state.content || ''
            }"
            :field-components="{
              content: 'CroutonEditorSimple'
            }"
            show-ai-translate
            field-type="locations"
            :label="$t('bookings.locationForm.translations')"
          />
        </div>
      </template>

      <template #footer>
        <CroutonValidationErrorSummary
          v-if="validationErrors.length > 0"
          :tab-errors="tabErrorCounts"
          :navigation-items="navigationItems"
          @switch-tab="switchToTab"
        />

        <CroutonFormActionButton
          :action="action"
          :collection="collection"
          :items="items"
          :loading="loading"
          :has-validation-errors="validationErrors.length > 0"
        />
      </template>
    </CroutonFormLayout>
  </UForm>
</template>

<script setup lang="ts">
import type { LocationData } from '../types/booking'

// useBookingsLocations is auto-imported from the generated collection layer at runtime
declare function useBookingsLocations(): {
  defaultValue: Record<string, any>
  schema: any
  collection: string
}

interface LocationFormProps {
  action: 'create' | 'update' | 'delete'
  items?: Array<{ id: string }>
  activeItem?: LocationData | null
}

const props = defineProps<LocationFormProps>()
const { defaultValue, schema, collection } = useBookingsLocations()
const { t } = useT()

// Optional maps integration — gracefully degrades when crouton-maps is not installed
const { hasApp } = useCroutonApps()
const hasMaps = hasApp('maps')

// Load team members for access control picker
const { members: teamMembers, loadMembers } = useTeam()
const membersLoading = ref(false)

onMounted(async () => {
  membersLoading.value = true
  try { await loadMembers() } finally { membersLoading.value = false }
})

const memberItems = computed(() =>
  teamMembers.value.map((m: any) => ({
    label: m.user?.name || m.user?.email || 'Unknown',
    email: m.user?.email || '',
    value: m.userId,
    avatar: { src: m.user?.image, alt: m.user?.name || m.user?.email || '' }
  }))
)

// Form layout: 4 tabs
const navigationItems = computed(() => [
  { label: t('bookings.locationForm.tabLocation'), value: 'location', icon: 'i-lucide-map-pin' },
  { label: t('bookings.locationForm.tabSettings'), value: 'settings', icon: 'i-lucide-settings' },
  { label: t('bookings.locationForm.tabBookings'), value: 'bookings', icon: 'i-lucide-calendar' },
  { label: t('bookings.locationForm.tabContent'), value: 'content', icon: 'i-lucide-globe' }
])

const tabs = ref(true)
const activeSection = ref('location')

// Map field names to tabs for validation error indicators
const fieldToGroup: Record<string, string> = {
  title: 'location',
  color: 'location',
  street: 'location',
  zip: 'location',
  city: 'location',
  content: 'location',
  location: 'location',
  allowedMemberIds: 'settings',
  offerFullDay: 'bookings',
  inventoryMode: 'bookings',
  quantity: 'bookings',
  maxBookingsPerMonth: 'bookings',
  slots: 'bookings',
  openDays: 'bookings',
  slotSchedule: 'bookings',
  blockedDates: 'bookings',
  translations: 'content'
}

const validationErrors = ref<Array<{ name: string; message: string }>>([])

const handleValidationError = (event: any) => {
  if (event?.errors) {
    validationErrors.value = event.errors
  }
}

const tabErrorCounts = computed(() => {
  const counts: Record<string, number> = {}
  validationErrors.value.forEach((error) => {
    const tabName = fieldToGroup[error.name] || 'settings'
    counts[tabName] = (counts[tabName] || 0) + 1
  })
  return counts
})

const switchToTab = (tabValue: string) => {
  activeSection.value = tabValue
}

// Data operations
const { create, update, deleteItems } = useCollectionMutation(collection)
const { close, loading } = useCrouton()

// Initialize form state
const initialValues = props.action === 'update' && props.activeItem?.id
  ? { ...defaultValue, ...props.activeItem }
  : { ...defaultValue }

const state = ref<LocationData & { id?: string | null }>(initialValues as any)

// --- Map & Geocoding (only active when @fyit/crouton-maps is installed) ---

const geocoding = ref(false)
const mapCenter = ref<[number, number]>([0, 0])
const mapInstance = ref<any>(null)

// Derive marker color from CSS --ui-primary at runtime
const markerColor = ref('#22c55e')
onMounted(async () => {
  if (!hasMaps) return
  const tempEl = document.createElement('div')
  tempEl.style.backgroundColor = 'var(--ui-primary)'
  tempEl.style.display = 'none'
  document.body.appendChild(tempEl)
  const computedColor = getComputedStyle(tempEl).backgroundColor
  document.body.removeChild(tempEl)
  if (computedColor?.startsWith('rgb')) {
    const m = computedColor.match(/\d+/g)
    if (m && m.length >= 3) {
      markerColor.value = `#${((1 << 24) + (Number(m[0]) << 16) + (Number(m[1]) << 8) + Number(m[2])).toString(16).slice(1)}`
    }
  }

  // Geocode initial address if fields are populated but no stored coordinates
  if (!initialCoordinates && (state.value.street || state.value.zip || state.value.city)) {
    await handleGeocode()
  }
})

// Parse existing coordinates from the location field
const parseCoordinates = (value: any): [number, number] | null => {
  if (!value) return null
  if (Array.isArray(value) && value.length === 2) {
    return [Number(value[0]), Number(value[1])]
  }
  if (typeof value === 'string') {
    try {
      return parseCoordinates(JSON.parse(value))
    } catch { return null }
  }
  // GeoJSON Point ({ type: 'Point', coordinates: [lng, lat] })
  if (typeof value === 'object' && Array.isArray(value.coordinates)) {
    return parseCoordinates(value.coordinates)
  }
  return null
}

const initialCoordinates = parseCoordinates(state.value.location)
if (initialCoordinates) mapCenter.value = initialCoordinates

const handleMapLoad = (map: any) => { mapInstance.value = map }

// Auto-geocode address changes via the /api/maps/geocode endpoint (no composable dependency)
watchDebounced(
  () => [state.value.street, state.value.zip, state.value.city],
  async () => {
    if (hasMaps && (state.value.street || state.value.zip)) {
      await handleGeocode()
    }
  },
  { debounce: 1000, maxWait: 3000 }
)

const handleGeocode = async () => {
  try {
    geocoding.value = true
    const parts: string[] = []
    if (state.value.street) parts.push(state.value.street as string)
    if (state.value.zip) parts.push(state.value.zip as string)
    if (state.value.city) parts.push(state.value.city as string)

    const query = parts.join(', ')
    if (!query.trim()) return

    const response = await $fetch<{ features: Array<{ center: [number, number] }> }>('/api/maps/geocode', {
      query: { q: query }
    })

    if (response.features?.[0]) {
      mapCenter.value = response.features[0].center
      state.value.location = JSON.stringify(response.features[0].center)
    }
  } catch {
    // Maps API not available or geocoding failed — silent fallback
  } finally {
    geocoding.value = false
  }
}

const handleMarkerDragEnd = (position: { lng: number; lat: number }) => {
  mapCenter.value = [position.lng, position.lat]
  state.value.location = JSON.stringify([position.lng, position.lat])
}

// --- Form submission ---

const handleSubmit = async () => {
  try {
    if (props.action === 'create') {
      await create(state.value)
    } else if (props.action === 'update' && state.value.id) {
      await update(state.value.id, state.value)
    } else if (props.action === 'delete') {
      await deleteItems(props.items as any)
    }
    validationErrors.value = []
    close()
  } catch (error) {
    console.error('Form submission failed:', error)
  }
}
</script>
