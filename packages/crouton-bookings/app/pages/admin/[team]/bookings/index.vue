<script setup lang="ts">
const route = useRoute()
const { teamId } = useTeamContext()
const { t } = useT()

// Use route param directly for stable SSR/client URL (avoids hydration mismatch
// caused by useTeamContext returning UUID on server vs slug on client)
const teamParam = computed(() => route.params.team as string)

// Preview / impersonation state
const isPreview = ref(false)
const impersonatedUserId = ref<string | null>(null)
provide('bookings-preview-mode', isPreview)

// Admin data: all team bookings with email details
const { data: adminBookings, pending: adminBookingsPending, refresh: refreshAdminBookings } = await useFetch(
  () => `/api/crouton-bookings/teams/${teamParam.value}/admin-bookings`,
  {
    default: () => [],
  }
)

const { items: locations, pending: locationsPending } = await useCollectionQuery('bookingsLocations')
const { items: settings, pending: settingsPending } = await useCollectionQuery('bookingsSettings')

// Extract unique bookers from admin bookings for impersonation picker
const uniqueBookers = computed(() => {
  const seen = new Map<string, { id: string, name: string, email: string, avatarUrl?: string | null }>()
  for (const b of adminBookings.value) {
    const user = b.ownerUser || b.createdByUser
    if (user?.id && user.name?.trim()) {
      if (!seen.has(user.id)) {
        seen.set(user.id, { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl })
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
})

// Resolved bookings: filter by impersonated user when in preview mode
const bookings = computed(() => {
  if (!isPreview.value) return adminBookings.value
  if (!impersonatedUserId.value) return adminBookings.value
  return adminBookings.value.filter((b: any) => {
    const userId = b.ownerUser?.id || b.createdByUser?.id || b.owner || b.createdBy
    return userId === impersonatedUserId.value
  })
})

const loading = computed(() => adminBookingsPending.value || locationsPending.value || settingsPending.value)
const firstSettings = computed(() => settings.value?.[0] ?? null)

// Current impersonated user info
const impersonatedUser = computed(() => {
  if (!impersonatedUserId.value) return null
  return uniqueBookers.value.find(u => u.id === impersonatedUserId.value) ?? null
})

// Start impersonation for a specific user
function startImpersonation(userId: string) {
  impersonatedUserId.value = userId
  isPreview.value = true
}

// Exit preview / impersonation
function exitPreview() {
  isPreview.value = false
  impersonatedUserId.value = null
}

// Refresh bookings when a new booking is created, updated, or email sent
async function handleBookingChange() {
  await refreshAdminBookings()
}
</script>

<template>
  <div class="w-full flex-1 min-h-0 p-4 sm:p-6 flex flex-col gap-3">
    <!-- Impersonation banner -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div
        v-if="isPreview"
        class="flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-warning/10 border border-warning/30 text-warning"
      >
        <div class="flex items-center gap-2 text-sm font-medium">
          <UIcon name="i-lucide-eye" class="size-4" />
          <span>{{ t('bookings.admin.viewingAs') }} <strong>{{ impersonatedUser?.name || 'member' }}</strong></span>
        </div>
        <UButton size="xs" color="warning" variant="soft" icon="i-lucide-x" @click="exitPreview">
          {{ t('bookings.admin.exit') }}
        </UButton>
      </div>
    </Transition>

    <div class="flex items-center justify-end gap-2">
      <!-- Impersonate user dropdown -->
      <UDropdownMenu
        v-if="!isPreview && uniqueBookers.length > 0"
        :items="uniqueBookers.map(u => ({
          label: u.name,
          icon: 'i-lucide-user',
          onSelect: () => startImpersonation(u.id)
        }))"
        :content="{ align: 'end' }"
      >
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-user-check"
        >
          {{ t('bookings.admin.viewAsUser') }}
        </UButton>
      </UDropdownMenu>
    </div>

    <div class="flex-1 min-h-0 flex flex-col">
      <CroutonBookingsPanel
        class="flex-1"
        :bookings="bookings"
        :locations="locations"
        :settings="firstSettings"
        :loading="loading"
        title=""
        :empty-message="isPreview ? t('bookings.admin.noBookingsForUser', { name: impersonatedUser?.name || t('bookings.admin.thisUser') }) : t('bookings.admin.noBookingsForTeam')"
        @created="handleBookingChange"
        @updated="handleBookingChange"
      />
    </div>
  </div>
</template>
