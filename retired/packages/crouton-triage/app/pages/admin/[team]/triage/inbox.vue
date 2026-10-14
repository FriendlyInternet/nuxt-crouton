<template>
  <div class="p-4 space-y-6">
      <!-- Message Type Statistics -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <UCard>
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-lucide-inbox" class="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p class="text-2xl font-bold">{{ messageStats.total }}</p>
              <p class="text-xs text-muted-foreground">Total Messages</p>
            </div>
          </div>
        </UCard>

        <UCard>
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-lucide-mail-check" class="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p class="text-2xl font-bold">{{ messageStats.verification }}</p>
              <p class="text-xs text-muted-foreground">Verification</p>
            </div>
          </div>
        </UCard>

        <UCard>
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-lucide-key" class="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p class="text-2xl font-bold">{{ messageStats.passwordReset }}</p>
              <p class="text-xs text-muted-foreground">Password Reset</p>
            </div>
          </div>
        </UCard>

        <UCard>
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-lucide-user-plus" class="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <p class="text-2xl font-bold">{{ messageStats.invitation }}</p>
              <p class="text-xs text-muted-foreground">Invitations</p>
            </div>
          </div>
        </UCard>

        <UCard>
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-gray-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-lucide-mail" class="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <p class="text-2xl font-bold">{{ messageStats.unread }}</p>
              <p class="text-xs text-muted-foreground">Unread</p>
            </div>
          </div>
        </UCard>
      </div>

      <!-- Filters and Actions -->
      <UCard>
        <div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <!-- Message Type Filter -->
          <div class="flex flex-wrap gap-2" role="group" aria-label="Filter messages by type">
            <UButton
              v-for="filter in messageFilters"
              :key="filter.value"
              :color="selectedFilter === filter.value ? 'primary' : 'neutral'"
              :variant="selectedFilter === filter.value ? 'solid' : 'outline'"
              size="sm"
              @click="selectedFilter = filter.value"
              :aria-pressed="selectedFilter === filter.value"
              :aria-label="`Filter by ${filter.label.toLowerCase()}`"
              class="touch-manipulation"
            >
              {{ filter.label }}
              <span v-if="filter.count !== undefined" class="ml-1 opacity-75">
                ({{ filter.count }})
              </span>
            </UButton>
          </div>

          <!-- Refresh Button -->
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-refresh-cw"
            @click="refresh"
            :disabled="pending"
            aria-label="Refresh inbox messages"
          >
            <span class="hidden sm:inline">Refresh</span>
          </UButton>
        </div>
      </UCard>

      <!-- Loading State -->
      <div v-if="pending" class="space-y-3">
        <div v-for="i in 5" :key="i" class="animate-pulse">
          <UCard>
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-full bg-muted"></div>
              <div class="flex-1 space-y-2">
                <div class="h-4 bg-muted rounded w-3/4"></div>
                <div class="h-3 bg-muted rounded w-1/2"></div>
              </div>
            </div>
          </UCard>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else-if="filteredMessages.length === 0" class="text-center py-12">
        <div class="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
          <UIcon name="i-lucide-inbox" class="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 class="text-lg font-semibold mb-2">No messages found</h3>
        <p class="text-sm text-muted-foreground">
          {{ getEmptyStateMessage() }}
        </p>
      </div>

      <!-- Message List -->
      <div v-else class="space-y-3">
        <UCard
          v-for="message in filteredMessages"
          :key="message.id"
          class="cursor-pointer hover:shadow-md transition-all"
          :class="{ 'bg-muted/30': !message.read }"
          @click="openEmailModal(message)"
          role="button"
          tabindex="0"
          @keydown.enter="openEmailModal(message)"
          @keydown.space.prevent="openEmailModal(message)"
          :aria-label="`Open email: ${message.subject}`"
        >
          <div class="flex items-start gap-4">
            <!-- Icon -->
            <div class="flex-shrink-0 mt-1">
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center"
                :class="getMessageIconClass(message.messageType)"
              >
                <UIcon :name="getMessageIcon(message.messageType)" class="w-5 h-5" />
              </div>
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2 mb-2">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 mb-1">
                    <h3 class="text-sm font-semibold truncate">{{ message.subject }}</h3>
                    <UBadge
                      v-if="!message.read"
                      color="primary"
                      size="xs"
                    >
                      New
                    </UBadge>
                  </div>
                  <p class="text-xs text-muted-foreground">
                    From: {{ message.from }}
                  </p>
                </div>
                <UBadge
                  :color="getMessageTypeColor(message.messageType)"
                  size="xs"
                  class="flex-shrink-0"
                >
                  {{ getMessageTypeLabel(message.messageType) }}
                </UBadge>
              </div>

              <div class="flex items-center gap-2 text-xs text-muted-foreground">
                <UIcon name="i-lucide-clock" class="w-3 h-3" />
                <span>{{ formatRelativeTime(String(message.receivedAt ?? '')) }}</span>
                <span v-if="message.forwardedTo">
                  • <UIcon name="i-lucide-forward" class="w-3 h-3 inline" /> Forwarded
                </span>
              </div>
            </div>
          </div>
        </UCard>
      </div>

    <!-- Email View Modal -->
    <UModal v-model:open="isModalOpen">
      <template #content="{ close }">
        <div v-if="selectedMessage" class="p-6">
          <!-- Modal Header -->
          <div class="flex items-start justify-between gap-4 mb-6">
            <div class="flex-1 min-w-0">
              <h2 class="text-xl font-bold mb-2">{{ selectedMessage.subject }}</h2>
              <div class="space-y-1 text-sm text-muted-foreground">
                <p><strong>From:</strong> {{ selectedMessage.from }}</p>
                <p><strong>To:</strong> {{ selectedMessage.to }}</p>
                <p><strong>Received:</strong> {{ formatFullDate(selectedMessage.receivedAt) }}</p>
              </div>
            </div>
            <UBadge :color="getMessageTypeColor(selectedMessage.messageType)">
              {{ getMessageTypeLabel(selectedMessage.messageType) }}
            </UBadge>
          </div>

          <!-- Action Buttons -->
          <div class="flex gap-2 mb-6">
            <UButton
              v-if="!selectedMessage.read"
              color="primary"
              size="sm"
              icon="i-lucide-check"
              @click="markAsRead(selectedMessage)"
              :disabled="markingAsRead"
            >
              Mark as Read
            </UButton>
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-external-link"
              @click="openInNewTab(selectedMessage)"
              v-if="extractedLinks.length > 0"
            >
              Open Links
            </UButton>
          </div>

          <!-- Extracted Links -->
          <div v-if="extractedLinks.length > 0" class="mb-6">
            <h3 class="text-sm font-semibold mb-2">Important Links</h3>
            <div class="space-y-2">
              <a
                v-for="(link, index) in extractedLinks"
                :key="index"
                :href="link.url"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-2 text-sm text-primary hover:underline p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <UIcon name="i-lucide-link" class="w-4 h-4 flex-shrink-0" />
                <span class="truncate">{{ link.text || link.url }}</span>
                <UIcon name="i-lucide-external-link" class="w-3 h-3 flex-shrink-0 ml-auto" />
              </a>
            </div>
          </div>

          <!-- Email Content -->
          <div class="border rounded-lg p-4 bg-muted/30 max-h-[400px] overflow-y-auto">
            <h3 class="text-sm font-semibold mb-3">Email Content</h3>
            <div v-if="selectedMessage.htmlBody" v-html="sanitizedHtmlContent" class="prose prose-sm max-w-none"></div>
            <div v-else-if="selectedMessage.textBody" class="whitespace-pre-wrap text-sm">
              {{ selectedMessage.textBody }}
            </div>
            <p v-else class="text-sm text-muted-foreground italic">No content available</p>
          </div>

          <!-- Close Button -->
          <div class="flex justify-end gap-2 mt-6">
            <UButton color="neutral" variant="ghost" @click="close">
              Close
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
// Team context
const { currentTeam } = useTeam()
const notify = useNotify()

// Data fetching
const { items: messages, pending, refresh } = await useCollectionQuery('triageMessages')
const { mutate } = useCroutonMutate()

// Filter state
const selectedFilter = ref<string>('all')

// Modal state
const isModalOpen = ref(false)
const selectedMessage = ref<any>(null)
const markingAsRead = ref(false)

// Message statistics
const messageStats = computed(() => {
  const msgs = messages.value || []
  return {
    total: msgs.length,
    verification: msgs.filter((m: any) => m.messageType === 'account-verification').length,
    passwordReset: msgs.filter((m: any) => m.messageType === 'password-reset').length,
    invitation: msgs.filter((m: any) => m.messageType === 'invitation').length,
    unread: msgs.filter((m: any) => !m.read).length
  }
})

// Filter definitions
const messageFilters = computed(() => [
  { value: 'all', label: 'All', count: messageStats.value.total },
  { value: 'account-verification', label: 'Verification', count: messageStats.value.verification },
  { value: 'password-reset', label: 'Password Reset', count: messageStats.value.passwordReset },
  { value: 'invitation', label: 'Invitations', count: messageStats.value.invitation },
  { value: 'unread', label: 'Unread', count: messageStats.value.unread }
])

// Filtered messages
const filteredMessages = computed(() => {
  const msgs = messages.value || []

  if (selectedFilter.value === 'all') {
    return msgs
  }

  if (selectedFilter.value === 'unread') {
    return msgs.filter((m: any) => !m.read)
  }

  return msgs.filter((m: any) => m.messageType === selectedFilter.value)
})

// Sanitized HTML content - just return raw HTML since we're client-only now
const sanitizedHtmlContent = computed(() => {
  if (!selectedMessage.value?.htmlBody) return ''
  // Since SSR is disabled, we can safely return the HTML
  // Browser will handle it safely via v-html
  return selectedMessage.value.htmlBody
})

// Extract links from HTML (client-only, simple regex approach)
const extractedLinks = computed(() => {
  if (!selectedMessage.value?.htmlBody) return []
  if (!import.meta.client) return []

  try {
    // Simple regex to extract links instead of using cheerio
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi
    const links: Array<{ url: string; text: string }> = []
    let match

    while ((match = linkRegex.exec(selectedMessage.value!.htmlBody)) !== null) {
      const url = match[1]
      const text = match[2]!.trim()

      if (url && url.startsWith('http')) {
        const textLower = text.toLowerCase()
        // Filter for important links
        if (
          url.includes('figma.com') ||
          textLower.includes('verify') ||
          textLower.includes('reset') ||
          textLower.includes('confirm')
        ) {
          links.push({ url, text })
        }
      }
    }

    return links.slice(0, 5) // Limit to 5 most relevant links
  } catch (error: any) {
    console.error('[INBOX ERROR] extractedLinks:', error.message)
    return []
  }
})

// Helper functions
function getMessageIcon(messageType: string) {
  switch (messageType) {
    case 'account-verification':
      return 'i-lucide-mail-check'
    case 'password-reset':
      return 'i-lucide-key'
    case 'invitation':
      return 'i-lucide-user-plus'
    case 'notification':
      return 'i-lucide-bell'
    case 'comment':
      return 'i-lucide-message-square'
    default:
      return 'i-lucide-mail'
  }
}

function getMessageIconClass(messageType: string) {
  switch (messageType) {
    case 'account-verification':
      return 'bg-green-500/10 text-green-500'
    case 'password-reset':
      return 'bg-amber-500/10 text-amber-500'
    case 'invitation':
      return 'bg-purple-500/10 text-purple-500'
    case 'notification':
      return 'bg-blue-500/10 text-blue-500'
    case 'comment':
      return 'bg-primary/10 text-primary'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function getMessageTypeColor(messageType: string) {
  switch (messageType) {
    case 'account-verification':
      return 'success'
    case 'password-reset':
      return 'warning'
    case 'invitation':
      return 'primary'
    case 'notification':
      return 'info'
    default:
      return 'neutral'
  }
}

function getMessageTypeLabel(messageType: string) {
  switch (messageType) {
    case 'account-verification':
      return 'Verification'
    case 'password-reset':
      return 'Password Reset'
    case 'invitation':
      return 'Invitation'
    case 'notification':
      return 'Notification'
    case 'comment':
      return 'Comment'
    default:
      return 'Other'
  }
}

function formatRelativeTime(date: string) {
  // SSR-safe: Always use simple date math
  // (VueUse composables can't be called in render functions)
  const now = Date.now()
  const then = new Date(date).getTime()
  const diff = now - then
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}

function formatFullDate(date: string) {
  // SSR-safe date formatting
  const d = new Date(date)
  if (!import.meta.client) {
    // Simple ISO format for SSR
    return d.toISOString().replace('T', ' ').split('.')[0]
  }
  // Client-side: Use locale formatting
  return d.toLocaleString()
}

function getEmptyStateMessage() {
  switch (selectedFilter.value) {
    case 'account-verification':
      return 'No verification emails found'
    case 'password-reset':
      return 'No password reset emails found'
    case 'invitation':
      return 'No invitation emails found'
    case 'unread':
      return 'All caught up! No unread messages.'
    default:
      return 'Your inbox is empty. Emails will appear here when received.'
  }
}

// Actions
function openEmailModal(message: any) {
  selectedMessage.value = message
  isModalOpen.value = true
}

async function markAsRead(message: any) {
  markingAsRead.value = true
  try {
    await mutate('update', 'triageMessages', {
      id: message.id,
      read: true
    })

    // Update local state
    if (selectedMessage.value?.id === message.id) {
      selectedMessage.value.read = true
    }

    notify.success('Marked as read', { description: 'Email marked as read successfully' })

    await refresh()
  } catch (error: any) {
    console.error('Failed to mark as read:', error)
    notify.error('Failed to mark as read', { description: error.message || 'An error occurred' })
  } finally {
    markingAsRead.value = false
  }
}

function openInNewTab(message: any) {
  if (import.meta.client && extractedLinks.value.length > 0) {
    // Open the first link (usually the most important one)
    const firstLink = extractedLinks.value[0]
    if (firstLink) {
      window.open(firstLink.url, '_blank', 'noopener,noreferrer')
    }
  }
}
</script>
