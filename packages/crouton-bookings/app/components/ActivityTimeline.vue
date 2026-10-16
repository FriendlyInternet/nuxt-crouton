<script setup lang="ts">
import { computed } from 'vue'
import { useTimeAgo } from '@vueuse/core'
import type { Booking, EmailTriggerType } from '../types/booking'

interface Props {
  booking: Booking
}

const props = defineProps<Props>()
const { t } = useT()

// Get icon for email trigger type
function getEmailIcon(triggerType: EmailTriggerType, status: string): string {
  if (status === 'failed') return 'i-lucide-mail-x'
  if (status === 'pending') return 'i-lucide-clock'

  switch (triggerType) {
    case 'booking_created': return 'i-lucide-mail-check'
    case 'reminder_before': return 'i-lucide-bell-ring'
    case 'follow_up_after': return 'i-lucide-message-square-reply'
    case 'booking_cancelled': return 'i-lucide-mail-minus'
    default: return 'i-lucide-mail'
  }
}

// Interface for activity item
interface ActivityItem {
  date: Date
  username: string
  action: string
  icon: string
  type: 'booking' | 'email'
  failed?: boolean
  /** Why it failed (provider message), shown under the row */
  detail?: string | null
}

// Build combined timeline from booking data and email details
const activityItems = computed<ActivityItem[]>(() => {
  const items: ActivityItem[] = []
  const booking = props.booking

  // 1. Booking created
  if (booking.createdAt) {
    const createdByName = booking.createdByUser?.name || booking.ownerUser?.name || t('bookings.activity.someone')
    items.push({
      date: new Date(booking.createdAt),
      username: createdByName,
      action: t('bookings.activity.createdBooking'),
      icon: 'i-lucide-calendar-plus',
      type: 'booking',
    })
  }

  // 2. Email events from emailDetails
  if (booking.emailDetails) {
    for (const detail of booking.emailDetails) {
      const emailType = detail.triggerType === 'booking_created' ? t('bookings.activity.confirmation')
        : detail.triggerType === 'reminder_before' ? t('bookings.activity.reminder')
          : detail.triggerType === 'follow_up_after' ? t('bookings.activity.followUp')
            : detail.triggerType === 'booking_cancelled' ? t('bookings.activity.cancellation')
              : t('bookings.activity.emailLabel')
      const emailName = emailType.charAt(0).toUpperCase() + emailType.slice(1)
      if (detail.status === 'sent' && detail.sentAt) {
        items.push({
          date: new Date(detail.sentAt),
          username: emailName,
          action: t('bookings.activity.emailSent'),
          icon: getEmailIcon(detail.triggerType, detail.status),
          type: 'email',
        })
      }
      else if (detail.status === 'failed') {
        const attempted = detail.attemptedAt || detail.sentAt
        items.push({
          date: attempted ? new Date(attempted) : new Date(),
          username: emailName,
          action: t('bookings.activity.failedToSend'),
          icon: getEmailIcon(detail.triggerType, detail.status),
          type: 'email',
          failed: true,
          detail: detail.error,
        })
      }
    }
  }

  // 3. Booking updated (only if different from created)
  if (booking.updatedAt && booking.createdAt) {
    const createdDate = new Date(booking.createdAt)
    const updatedDate = new Date(booking.updatedAt)
    if (updatedDate.getTime() - createdDate.getTime() > 60000) {
      const updatedByName = booking.createdByUser?.name || t('bookings.activity.someone')
      items.push({
        date: updatedDate,
        username: updatedByName,
        action: t('bookings.activity.updatedBooking'),
        icon: 'i-lucide-pencil',
        type: 'booking',
      })
    }
  }

  // 4. Booking cancelled
  if (booking.status === 'cancelled') {
    const cancelDate = booking.updatedAt ? new Date(booking.updatedAt) : new Date()
    items.push({
      date: cancelDate,
      username: t('bookings.activity.bookingLabel'),
      action: t('bookings.activity.wasCancelled'),
      icon: 'i-lucide-calendar-x',
      type: 'booking',
    })
  }

  // Sort by date (oldest first)
  return items.sort((a, b) => a.date.getTime() - b.date.getTime())
})

// Convert to timeline items format
const timelineItems = computed(() => {
  return activityItems.value.map((item, index) => ({
    ...item,
    value: index,
  }))
})

// Determine active value (most recent past event)
const activeValue = computed(() => {
  const now = new Date()
  let lastIndex = 0
  for (let i = 0; i < activityItems.value.length; i++) {
    if (activityItems.value[i]!.date <= now) {
      lastIndex = i
    }
  }
  return lastIndex
})
</script>

<template>
  <div v-if="timelineItems.length > 0" class="w-full">
    <UTimeline
      :items="(timelineItems as any)"
      :model-value="activeValue"
      size="xs"
      color="neutral"
      :ui="{
        date: 'float-end ms-1',
        wrapper: 'pb-1',
        indicator: 'bg-elevated text-muted group-data-[state=completed]:bg-elevated group-data-[state=completed]:text-muted group-data-[state=active]:bg-elevated group-data-[state=active]:text-muted',
        separator: 'bg-muted/30 group-data-[state=completed]:bg-muted/30',
      }"
    >
      <template #title="{ item }">
        <span class="font-medium" :class="item.failed ? 'text-error' : ''">{{ item.username }}</span>
        <span class="font-normal" :class="item.failed ? 'text-error' : 'text-muted'">&nbsp;{{ item.action }}</span>
      </template>

      <template #description="{ item }">
        <p v-if="item.detail" class="text-xs text-muted break-words">
          {{ item.detail }}
        </p>
      </template>

      <template #date="{ item }">
        <span class="text-xs text-dimmed">{{ useTimeAgo(item.date as any).value }}</span>
      </template>
    </UTimeline>
  </div>
  <div v-else class="text-sm text-muted py-2">
    {{ t('bookings.activity.noActivity') }}
  </div>
</template>
