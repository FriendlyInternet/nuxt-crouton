<script setup lang="ts">
import type { Booking, SlotItem, EmailTriggerType, EmailTriggerStatus } from '../types/booking'

interface Props {
  booking: Booking
  highlighted?: boolean
  /** Temporary highlight for just-created bookings (fades out) */
  justCreated?: boolean
  /** Which email action is currently being sent */
  sendingEmailType?: EmailTriggerType | null
}

const props = withDefaults(defineProps<Props>(), {
  highlighted: false,
  justCreated: false,
  sendingEmailType: null,
})

const emit = defineEmits<{
  'resend-email': [triggerType: EmailTriggerType]
  'date-click': [date: Date]
  'edit': [booking: Booking]
  'delete': [booking: Booking]
}>()

// Hover state for action menu
const isHovered = ref(false)
// Mobile email panel state
const isEmailPanelOpen = ref(false)
// Activity timeline panel state
const isTimelineOpen = ref(false)

const { t, locale } = useT()
const { parseSlotIds, parseLocationSlots, getSlotLabel } = useBookingSlots()
const { getGroupLabel } = useBookingOptions()
const { isEmailEnabled } = useBookingEmail()

// Preview mode - injected from admin page, defaults to false
const previewMode = inject<Ref<boolean>>('bookings-preview-mode', ref(false))
const showAdminFeatures = computed(() => !previewMode.value)

// Get localized location title with fallbacks
function getLocationTitle(locationData: Booking['locationData']): string {
  if (!locationData) return t('bookings.unknownLocation')
  const translations = locationData.translations as Record<string, { title?: string }> | undefined

  return translations?.[locale.value]?.title
    || translations?.en?.title
    || locationData.title
    || t('bookings.unknownLocation')
}

// Is this booking cancelled?
const isCancelled = computed(() => props.booking.status === 'cancelled')

// Parse slot IDs from booking
const bookedSlotIds = computed(() => parseSlotIds(props.booking.slot))

// Parse location slots
const locationSlots = computed<SlotItem[]>(() => {
  return parseLocationSlots(props.booking.locationData)
})

// Only the slots this booking actually covers (for display on the card)
const bookedSlots = computed<SlotItem[]>(() => {
  const ids = bookedSlotIds.value
  if (ids.length === 0) return []
  // If "all-day", show a single synthetic slot
  if (ids.includes('all-day')) {
    return [{ id: 'all-day', label: 'all-day' }]
  }
  return locationSlots.value.filter(s => ids.includes(s.id))
})

// Get booked slot labels for display
const slotLabel = computed(() => {
  const slotIds = bookedSlotIds.value
  if (slotIds.length === 0) return ''
  const labels = slotIds.map(id => getSlotLabel(id, locationSlots.value))
  return labels.join(', ')
})

// Location color for slot indicator
const locationColor = computed(() => {
  return props.booking.locationData?.color || '#3b82f6'
})

// Is this an inventory mode booking?
const isInventoryMode = computed(() => {
  return props.booking.locationData?.inventoryMode === true
})

// Booker info - handle Drizzle leftJoin which returns { id: null, name: null } instead of null
const bookerUser = computed(() => {
  const owner = props.booking.ownerUser
  const createdBy = props.booking.createdByUser

  // Prefer owner, fallback to createdBy
  if (owner?.name && owner.name.trim()) {
    return { name: owner.name, email: owner.email, avatarUrl: owner.avatarUrl }
  }
  if (createdBy?.name && createdBy.name.trim()) {
    return { name: createdBy.name, email: createdBy.email, avatarUrl: createdBy.avatarUrl }
  }
  return null
})

// Format date for display (e.g., "Jan 5") — handles string, Date, or numeric timestamp
function formatShortDate(value: string | number | Date): string {
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  if (isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' }).format(date)
}

// Format created date (e.g., "Jan 5")
const createdDateText = computed(() => {
  if (!props.booking.createdAt) return ''
  return formatShortDate(props.booking.createdAt)
})

// Email details from API
const emailDetails = computed(() => props.booking.emailDetails || [])

// Timeline item for email status display
interface TimelineItem {
  type: EmailTriggerType
  icon: string
  label: string
  status: 'sent' | 'pending' | 'failed' | 'not_sent'
  date: string | null
  tooltip: string
}

// Get opacity class based on email status
function getTimelineOpacity(status: TimelineItem['status']): string {
  switch (status) {
    case 'sent': return 'opacity-100'
    case 'pending': return 'opacity-70'
    case 'failed': return 'opacity-100 text-error'
    default: return 'opacity-50 hover:opacity-80'
  }
}

// Get status info for popover display
function getStatusInfo(item: TimelineItem): { icon: string; label: string; color: string; action: string } {
  const dateSuffix = item.date ? ` · ${item.date}` : ''
  switch (item.status) {
    case 'sent': return {
      icon: 'i-lucide-circle-check',
      label: t('bookings.card.emailStatus.sent') + dateSuffix,
      color: '',
      action: t('bookings.card.emailStatus.clickToResend'),
    }
    case 'pending': return {
      icon: 'i-lucide-clock',
      label: t('bookings.card.emailStatus.pending') + dateSuffix,
      color: '',
      action: t('bookings.card.emailStatus.clickToSend'),
    }
    case 'failed': return {
      icon: 'i-lucide-triangle-alert',
      label: t('bookings.card.emailStatus.failed'),
      color: 'text-error',
      action: t('bookings.card.emailStatus.clickToRetry'),
    }
    default: return {
      icon: 'i-lucide-circle-dashed',
      label: t('bookings.card.emailStatus.notSent'),
      color: '',
      action: t('bookings.card.emailStatus.clickToSend'),
    }
  }
}

// Format timeline date from ISO string
function formatTimelineDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const date = new Date(dateStr)
  return new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short' }).format(date)
}

// Config for each email trigger type
const triggerConfig: Record<string, { sentIcon: string; defaultIcon: string; labelKey: string; sentTooltipKey: string; defaultTooltipKey: string }> = {
  booking_created: {
    sentIcon: 'i-lucide-mail-check',
    defaultIcon: 'i-lucide-mail',
    labelKey: 'bookings.card.emailLabels.confirm',
    sentTooltipKey: 'bookings.card.emailTooltips.resendConfirmation',
    defaultTooltipKey: 'bookings.card.emailTooltips.sendConfirmation',
  },
  reminder_before: {
    sentIcon: 'i-lucide-bell-ring',
    defaultIcon: 'i-lucide-bell',
    labelKey: 'bookings.card.emailLabels.reminder',
    sentTooltipKey: 'bookings.card.emailTooltips.resendReminder',
    defaultTooltipKey: 'bookings.card.emailTooltips.sendReminder',
  },
  follow_up_after: {
    sentIcon: 'i-lucide-message-square-reply',
    defaultIcon: 'i-lucide-message-square',
    labelKey: 'bookings.card.emailLabels.followUp',
    sentTooltipKey: 'bookings.card.emailTooltips.resendFollowUp',
    defaultTooltipKey: 'bookings.card.emailTooltips.sendFollowUp',
  },
  booking_cancelled: {
    sentIcon: 'i-lucide-mail-x',
    defaultIcon: 'i-lucide-mail-minus',
    labelKey: 'bookings.card.emailLabels.cancelled',
    sentTooltipKey: 'bookings.card.emailTooltips.resendCancellation',
    defaultTooltipKey: 'bookings.card.emailTooltips.sendCancellation',
  },
}

// Build timeline items from email details — only shows buttons for trigger types
// that have an active template (server only returns entries when a template or log exists)
const timelineItems = computed<TimelineItem[]>(() => {
  const items: TimelineItem[] = []

  for (const detail of emailDetails.value) {
    const config = triggerConfig[detail.triggerType]
    if (!config) continue

    // Skip non-cancelled triggers for cancelled bookings, and vice versa
    if (isCancelled.value && detail.triggerType !== 'booking_cancelled') continue
    if (!isCancelled.value && detail.triggerType === 'booking_cancelled') continue

    const isSent = detail.status === 'sent'
    // Use booking createdAt as fallback date for confirmation
    const dateStr = detail.triggerType === 'booking_created'
      ? (detail.sentAt || (props.booking.createdAt ? String(props.booking.createdAt) : null))
      : (detail.sentAt || detail.scheduledFor)

    items.push({
      type: detail.triggerType as EmailTriggerType,
      icon: isSent ? config.sentIcon : config.defaultIcon,
      label: t(config.labelKey),
      status: detail.status as TimelineItem['status'],
      date: formatTimelineDate(dateStr),
      tooltip: isSent ? t(config.sentTooltipKey) : t(config.defaultTooltipKey),
    })
  }

  return items
})
</script>

<template>
  <UCard
    variant="soft"
    :ui="{
      root: [
        'transition-all duration-700 relative overflow-hidden',
        isCancelled ? 'opacity-60' : '',
        justCreated ? 'ring-2 ring-primary/60 bg-primary/5 shadow-md' :
        highlighted ? 'bg-elevated shadow-sm' : ''
      ],
      body: 'p-0 sm:p-0',
    }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- Main layout: responsive flex with space-between on desktop -->
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-3 relative overflow-hidden">
      <!-- Edit button: absolute on the right, slides in on hover (desktop only) -->
      <div
        v-if="showAdminFeatures"
        class="hidden md:flex absolute right-0 top-0 bottom-0 flex-col items-center justify-center px-2 bg-elevated/95 transition-transform duration-200 ease-out z-10"
        :class="isHovered ? 'translate-x-0' : 'translate-x-full'"
      >
        <UButton
          variant="ghost"
          color="neutral"
          size="xs"
          icon="i-lucide-pencil"
          @click="emit('edit', booking)"
        />
      </div>

      <!-- Left side: Date badge + Info + Mobile actions -->
      <div class="p-1.5 md:p-2 flex gap-2 md:gap-3 flex-1 min-w-0">
        <!-- Date badge (clickable to navigate calendar). Deliberately a raw
             button (#1410): an invisible hit-area around a data-display badge —
             a themed UButton surface would fight the badge's own chrome. -->
        <button
          type="button"
          class="shrink-0 cursor-pointer hover:scale-105 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-lg self-start"
          @click="emit('date-click', new Date(booking.date))"
        >
          <CroutonBookingsDateBadge
            :date="booking.date"
            :variant="isCancelled ? 'error' : 'primary'"
            :highlighted="highlighted"
          />
        </button>

        <!-- Card info -->
        <div class="flex-1 min-w-0 flex flex-col gap-1.5">
          <!-- Location name -->
          <span
            class="text-sm font-medium truncate"
            :class="{ 'line-through text-muted': isCancelled }"
          >
            {{ getLocationTitle(booking.locationData) }}
          </span>

          <!-- Slot indicator + time + group -->
          <div class="flex items-center gap-2 flex-wrap">
            <template v-if="isInventoryMode">
              <span
                class="size-2 rounded-full shrink-0"
                :style="{ backgroundColor: isCancelled ? '#ef4444' : locationColor }"
              />
              <span class="text-xs tabular-nums" :class="isCancelled ? 'text-red-400' : 'text-muted'">
                {{ booking.quantity ?? 1 }} / {{ booking.locationData?.quantity || '?' }}
              </span>
            </template>
            <template v-else>
              <!-- Show slot indicator for booked slots only -->
              <CroutonBookingsSlotIndicator
                v-if="bookedSlots.length > 0"
                :slots="bookedSlots"
                :booked-slot-ids="bookedSlotIds"
                :cancelled-slot-ids="isCancelled ? bookedSlotIds : []"
                :color="locationColor"
                size="sm"
                variant="dots"
              />
              <span class="text-xs text-muted">{{ slotLabel }}</span>
            </template>

            <!-- Group badge inline -->
            <UBadge
              v-if="booking.group"
              color="neutral"
              variant="subtle"
              size="sm"
            >
              {{ getGroupLabel(booking.group) }}
            </UBadge>
          </div>

          <!-- User info row -->
          <div class="flex items-center gap-1 text-xs text-muted">
            <template v-if="bookerUser">
              <UPopover>
                <span class="cursor-pointer hover:text-default transition-colors">{{ bookerUser.name }}</span>
                <template #content>
                  <div class="p-3 space-y-1 text-sm">
                    <div class="font-medium">{{ bookerUser.name }}</div>
                    <div v-if="bookerUser.email" class="text-muted text-xs">{{ bookerUser.email }}</div>
                  </div>
                </template>
              </UPopover>
              <!-- UButton (not raw) so themes reach it (#1410) -->
              <UButton
                v-if="createdDateText && showAdminFeatures"
                color="neutral"
                variant="link"
                size="xs"
                class="p-0 gap-1 whitespace-nowrap font-normal text-inherit hover:text-default"
                @click.stop="isTimelineOpen = !isTimelineOpen"
              >
                <span>{{ t('bookings.card.on', { params: { date: createdDateText } }) }}</span>
                <UIcon name="i-lucide-history" class="size-3" />
              </UButton>
              <span v-else-if="createdDateText" class="whitespace-nowrap">{{ t('bookings.card.on', { params: { date: createdDateText } }) }}</span>
            </template>
          </div>
        </div>

        <!-- Mobile action sidebar (right edge, full card height) -->
        <!-- UButtons (not raw) so themes reach them (#1410) -->
        <div v-if="showAdminFeatures" class="md:hidden shrink-0 flex flex-col justify-between items-center py-0.5 border-l border-muted/20 pl-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            square
            class="p-1 text-muted hover:text-default"
            @click.stop="emit('edit', booking)"
          >
            <UIcon name="i-lucide-pencil" class="size-3.5" />
          </UButton>
          <UButton
            v-if="isEmailEnabled && timelineItems.length > 0"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            class="p-1"
            :class="isEmailPanelOpen ? 'text-default' : 'text-muted hover:text-default'"
            @click.stop="isEmailPanelOpen = !isEmailPanelOpen"
          >
            <UIcon name="i-lucide-mail" class="size-3.5" />
          </UButton>
        </div>
      </div>

      <!-- Email timeline (desktop only, admin only) -->
      <div
        v-if="showAdminFeatures && isEmailEnabled && timelineItems.length > 0"
        class="hidden md:flex items-center gap-4 pr-14 transition-transform"
        :class="isHovered ? 'translate-x-0' : 'translate-x-10'"
      >
        <UPopover
          v-for="item in timelineItems"
          :key="item.type"
          mode="hover"
          arrow
          :open-delay="0"
          :close-delay="150"
          :content="{ side: 'top', align: 'center' }"
        >
          <!-- UButton (not raw) so themes reach it (#1410); flex-col stack kept -->
          <UButton
            color="neutral"
            variant="ghost"
            class="flex-col items-center gap-1 p-1 transition-all hover:scale-105"
            :class="[
              getTimelineOpacity(item.status),
              sendingEmailType === item.type ? 'animate-pulse' : ''
            ]"
            :disabled="!!sendingEmailType"
            @click="emit('resend-email', item.type)"
          >
            <UIcon :name="item.icon" class="size-5" />
            <span class="text-xs font-medium whitespace-nowrap">{{ item.label }}</span>
            <span class="text-[11px] text-muted whitespace-nowrap">{{ item.date || '—' }}</span>
          </UButton>

          <template #content>
            <div class="px-3 py-2 space-y-1.5 min-w-36">
              <div class="flex items-center gap-1.5" :class="getStatusInfo(item).color">
                <UIcon :name="getStatusInfo(item).icon" class="size-3.5 shrink-0" />
                <span class="text-xs font-medium">{{ getStatusInfo(item).label }}</span>
              </div>
              <span class="text-[11px] text-muted block">{{ getStatusInfo(item).action }}</span>
            </div>
          </template>
        </UPopover>
      </div>
    </div>

    <!-- Mobile email panel (admin only) — triggered by inline mail icon above -->
    <div
      v-if="showAdminFeatures && isEmailEnabled && timelineItems.length > 0"
      class="md:hidden overflow-hidden transition-all duration-200 ease-out"
      :class="isEmailPanelOpen ? 'max-h-28 opacity-100' : 'max-h-0 opacity-0'"
    >
      <div class="flex items-center gap-4 px-2 pb-2 pt-1 border-t border-muted/20">
        <!-- UButton (not raw) so themes reach it (#1410); flex-col stack kept -->
        <UButton
          v-for="item in timelineItems"
          :key="item.type"
          color="neutral"
          variant="ghost"
          class="flex-col items-center gap-1 p-1 transition-all active:scale-95"
          :class="[
            getTimelineOpacity(item.status),
            sendingEmailType === item.type ? 'animate-pulse' : ''
          ]"
          :disabled="!!sendingEmailType"
          @click="emit('resend-email', item.type)"
        >
          <UIcon :name="item.icon" class="size-5" />
          <span class="text-xs font-medium whitespace-nowrap">{{ item.label }}</span>
          <div class="flex items-center gap-1" :class="getStatusInfo(item).color">
            <UIcon :name="getStatusInfo(item).icon" class="size-2.5" />
            <span class="text-[10px] whitespace-nowrap">{{ getStatusInfo(item).label }}</span>
          </div>
        </UButton>
      </div>
    </div>

    <!-- Activity slide-out content -->
    <div
      class="overflow-hidden transition-all duration-300 ease-out"
      :class="isTimelineOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'"
    >
      <div class="border-t border-default/40 px-3 py-2">
        <CroutonBookingsActivityTimeline :booking="booking" />
      </div>
    </div>
  </UCard>
</template>
