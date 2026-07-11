<script setup lang="ts">
/**
 * Account Sessions Component
 *
 * Shows active sessions with device/location info.
 * Allows revoking individual sessions or all other sessions.
 */
import { useAuthClientSafe } from '../../../types/auth-client'

interface SessionInfo {
  id: string
  token: string
  userId: string
  expiresAt: Date
  ipAddress?: string
  userAgent?: string
  createdAt: Date
  updatedAt: Date
  isCurrent?: boolean
}

const { t } = useT()
const authClient = useAuthClientSafe()
const notify = useNotify()
const { session: currentSession } = useSession()

const sessions = ref<SessionInfo[]>([])
const loading = ref(false)
const revoking = ref<string | null>(null)
const revokingAll = ref(false)

onMounted(async () => {
  await loadSessions()
})

async function loadSessions() {
  if (!authClient) return
  loading.value = true
  try {
    const { data } = await authClient.listSessions()
    if (data) {
      sessions.value = data.map(s => ({
        ...s,
        ipAddress: s.ipAddress ?? undefined,
        userAgent: s.userAgent ?? undefined,
        expiresAt: new Date(s.expiresAt),
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
        isCurrent: s.token === currentSession.value?.token
      }))
    }
  } catch {
    notify.error(t('errors.generic'), { description: t('account.sessions.failedToLoad') })
  } finally {
    loading.value = false
  }
}

async function revokeSession(token: string) {
  if (!authClient) return
  revoking.value = token
  try {
    await authClient.revokeSession({ token })
    sessions.value = sessions.value.filter(s => s.token !== token)
    notify.success(t('account.sessions.sessionRevoked'))
  } catch {
    notify.error(t('errors.generic'), { description: t('account.sessions.failedToRevoke') })
  } finally {
    revoking.value = null
  }
}

async function revokeOtherSessions() {
  if (!authClient) return
  revokingAll.value = true
  try {
    await authClient.revokeOtherSessions()
    sessions.value = sessions.value.filter(s => s.isCurrent)
    notify.success(t('account.sessions.otherSessionsRevoked'))
  } catch {
    notify.error(t('errors.generic'), { description: t('account.sessions.failedToRevokeOthers') })
  } finally {
    revokingAll.value = false
  }
}

function parseUserAgent(ua?: string): { browser: string, os: string, icon: string } {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', icon: 'i-lucide-monitor' }

  let browser = 'Unknown'
  let os = 'Unknown'
  let icon = 'i-lucide-monitor'

  if (ua.includes('Firefox')) browser = 'Firefox'
  else if (ua.includes('Edg/')) browser = 'Edge'
  else if (ua.includes('Chrome')) browser = 'Chrome'
  else if (ua.includes('Safari')) browser = 'Safari'
  else if (ua.includes('Opera') || ua.includes('OPR')) browser = 'Opera'

  if (ua.includes('iPhone') || ua.includes('iPad')) { os = 'iOS'; icon = 'i-lucide-smartphone' }
  else if (ua.includes('Android')) { os = 'Android'; icon = 'i-lucide-smartphone' }
  else if (ua.includes('Mac OS')) { os = 'macOS'; icon = 'i-lucide-laptop' }
  else if (ua.includes('Windows')) { os = 'Windows'; icon = 'i-lucide-monitor' }
  else if (ua.includes('Linux')) { os = 'Linux'; icon = 'i-lucide-monitor' }

  return { browser, os, icon }
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

const otherSessionsCount = computed(() => sessions.value.filter(s => !s.isCurrent).length)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">
          {{ t('account.sessions.title') }}
        </h3>
        <p class="text-sm text-muted mt-1">
          {{ t('account.sessions.description') }}
        </p>
      </div>
      <UButton
        v-if="otherSessionsCount > 0"
        color="error"
        variant="soft"
        size="sm"
        icon="i-lucide-log-out"
        :loading="revokingAll"
        @click="revokeOtherSessions"
      >
        {{ t('account.sessions.revokeOthers') }}
      </UButton>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="py-6 text-center text-muted">
      <UIcon name="i-lucide-loader-2" class="size-5 animate-spin mx-auto mb-2" />
      <p class="text-sm">
        {{ t('account.sessions.loading') }}
      </p>
    </div>

    <!-- Sessions list -->
    <div v-else class="space-y-3">
      <div
        v-for="s in sessions"
        :key="s.token"
        class="flex items-center justify-between p-4 rounded-lg border transition-colors"
        :class="s.isCurrent ? 'border-primary bg-primary/5' : 'border-default bg-elevated'"
      >
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center size-10 rounded-lg bg-muted">
            <UIcon :name="parseUserAgent(s.userAgent).icon" class="size-5" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-medium text-sm">
                {{ parseUserAgent(s.userAgent).browser }} on {{ parseUserAgent(s.userAgent).os }}
              </span>
              <UBadge v-if="s.isCurrent" color="primary" variant="subtle" size="xs">
                {{ t('account.sessions.current') }}
              </UBadge>
            </div>
            <div class="flex items-center gap-2 text-xs text-muted mt-0.5">
              <span v-if="s.ipAddress">{{ s.ipAddress }}</span>
              <span v-if="s.ipAddress">&middot;</span>
              <span>{{ t('account.sessions.lastActive') }} {{ formatDate(s.updatedAt) }}</span>
            </div>
          </div>
        </div>
        <UButton
          v-if="!s.isCurrent"
          color="error"
          variant="ghost"
          size="xs"
          icon="i-lucide-x"
          :loading="revoking === s.token"
          @click="revokeSession(s.token)"
        >
          {{ t('account.sessions.revoke') }}
        </UButton>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!loading && sessions.length === 0" class="py-6 text-center text-muted">
      <UIcon name="i-lucide-shield-check" class="size-6 mx-auto mb-2" />
      <p class="text-sm">
        {{ t('account.sessions.noSessions') }}
      </p>
    </div>
  </div>
</template>
