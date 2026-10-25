<script setup lang="ts">
/**
 * CroutonUserPill
 *
 * One pill for account + status: who you are (member / PIN visitor / signed out)
 * and what just happened (the crouton-core status feed). Menu content comes from
 * useUserMenuItems() — not re-implemented here.
 *
 * @example
 * ```vue
 * <CroutonUserPill />
 * <CroutonUserPill placement="inline" :extra-items="[{ label: 'Manage site', to: '/admin' }]" />
 * ```
 */
import type { DropdownMenuItem } from '@nuxt/ui'

interface Props {
  /** Show the status feed inside the pill */
  showStatus?: boolean
  /** auto = avatar-only under `sm` */
  compact?: 'auto' | 'always' | 'never'
  /** fixed = bottom-left overlay; inline = sits in the parent's flex row */
  placement?: 'fixed' | 'inline'
  /** Extra menu items (e.g. "Manage site"), rendered above sign out */
  extraItems?: DropdownMenuItem[]
  /** Use the account-settings modal instead of navigating to /account */
  useModal?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showStatus: true,
  compact: 'auto',
  placement: 'fixed',
  extraItems: () => [],
  useModal: false
})

const { t } = useT()
const route = useRoute()
const { user, userInitials, dropdownItems } = useUserMenuItems({ useModal: props.useModal })
const { currentTeam, currentRole } = useTeam()
const { current, recent, unread, markAllSeen, dismiss } = useCroutonStatus()

const pageChrome = useState<{ hideNav?: boolean, hideAuthControls?: boolean }>('pageChrome', () => ({}))
const scopedSession = useState<{ displayName: string } | null>('crouton:scoped-session', () => null)

const loginUrl = computed(() => `/auth/login?redirect=${encodeURIComponent(route.fullPath)}&dismissible=1`)

async function logoutScopedSession() {
  await (useNuxtApp().hooks as any).callHook('crouton:scoped-session:logout')
  reloadNuxtApp({ force: true })
}

// Relative time, refreshed while the menu is open
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 10_000) })
onUnmounted(() => { if (timer) clearInterval(timer) })

function timeAgo(ts: number): string {
  const diff = Math.floor((now.value - ts) / 1000)
  if (diff < 10) return t('userPill.justNow')
  if (diff < 60) return t('statusBar.secondsAgo', { count: diff })
  const mins = Math.floor(diff / 60)
  if (mins < 60) return t('statusBar.minutesAgo', { count: mins })
  return t('statusBar.hoursAgo', { count: Math.floor(mins / 60) })
}

const TYPE_ICON_COLOR: Record<string, string> = {
  success: 'text-success',
  info: 'text-info',
  warning: 'text-warning',
  error: 'text-error'
}

const TYPE_SURFACE: Record<string, string> = {
  success: 'bg-default bg-linear-to-r from-success/10 to-success/10 border-success/30 text-success',
  info: 'bg-default bg-linear-to-r from-info/10 to-info/10 border-info/30 text-info',
  warning: 'bg-default bg-linear-to-r from-warning/10 to-warning/10 border-warning/30 text-warning',
  error: 'bg-default bg-linear-to-r from-error/10 to-error/10 border-error/30 text-error'
}

const TYPE_DOT: Record<string, string> = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  error: 'bg-error'
}

const status = computed(() => (props.showStatus ? current.value : undefined))
const surface = computed(() => (status.value ? TYPE_SURFACE[status.value.type] : 'bg-muted border-default text-default'))
const dotClass = computed(() => {
  if (status.value) return TYPE_DOT[status.value.type]
  if (props.showStatus && unread.value > 0) return 'bg-warning'
  return 'bg-primary'
})

const showControls = computed(() => !pageChrome.value.hideAuthControls)
const isMember = computed(() => !!user.value)
const isVisitor = computed(() => !isMember.value && !!scopedSession.value)
const showSignIn = computed(() => !isMember.value && !isVisitor.value && showControls.value)
const visible = computed(() => (isMember.value && showControls.value) || isVisitor.value || showSignIn.value)

const displayName = computed(() => (isVisitor.value ? scopedSession.value!.displayName : user.value?.name ?? ''))
const firstName = computed(() => displayName.value.split(' ')[0])
const initial = computed(() => (isVisitor.value ? (displayName.value[0] ?? '?').toUpperCase() : userInitials.value))
const showName = computed(() => props.compact === 'never' ? true : props.compact === 'auto')
const nameClass = computed(() => (props.compact === 'auto' ? 'hidden sm:inline' : ''))

const menuItems = computed<DropdownMenuItem[][]>(() => {
  if (isVisitor.value) {
    return [
      [{ label: `${displayName.value} · ${t('userPill.helper')}`, avatar: { text: initial.value, alt: displayName.value }, type: 'label' }],
      [{ label: t('userPill.signOutHelper'), icon: 'i-lucide-log-out', color: 'error', onSelect: logoutScopedSession }]
    ]
  }

  const subtitle = [currentTeam.value?.name, currentRole.value].filter(Boolean).join(' · ')
  const header: DropdownMenuItem[] = [{
    label: displayName.value,
    description: subtitle || undefined,
    avatar: { src: user.value?.image ?? undefined, alt: displayName.value, text: initial.value },
    type: 'label'
  } as DropdownMenuItem]

  const recentGroup: DropdownMenuItem[] = props.showStatus && recent.value.length
    ? [
        { label: t('userPill.recent'), type: 'label' },
        ...recent.value.map(m => ({
          label: m.text,
          icon: m.icon,
          description: m.description ? `${m.description} · ${timeAgo(m.timestamp)}` : timeAgo(m.timestamp),
          class: TYPE_ICON_COLOR[m.type],
          onSelect: (e: Event) => e.preventDefault()
        } as DropdownMenuItem))
      ]
    : []

  // First group of dropdownItems is the user header — replaced by ours above
  const [, ...rest] = dropdownItems.value
  const withExtras = props.extraItems.length ? [rest[0] ?? [], props.extraItems, ...rest.slice(1)] : rest
  return [header, ...(recentGroup.length ? [recentGroup] : []), ...withExtras]
})

function onOpenChange(open: boolean) {
  if (!open) return
  markAllSeen()
  if (current.value?.type === 'error') dismiss(current.value.id)
}

function retry() {
  const s = current.value
  if (!s) return
  s.retry?.()
  dismiss(s.id)
}
</script>

<template>
  <!-- One pill, seven display states; the branches are display variations, not independent logic -->
  <!-- fallow-ignore-next-line complexity -->
  <div v-if="visible"
    :class="placement === 'fixed'
      ? 'fixed z-50 left-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))]'
      : 'relative shrink-0'"
  >
    <UButton
      v-if="showSignIn"
      :to="loginUrl"
      color="primary"
      icon="i-lucide-log-in"
      class="h-11 rounded-full"
      :label="t('userPill.signIn')"
    />

    <div
      v-else
      class="flex h-11 items-center rounded-full border transition-colors duration-300"
      :class="[surface, placement === 'fixed' ? 'flex-row-reverse' : '']"
    >
      <!-- Status message: widens via max-width; the feed owns the lifetime -->
      <div
        class="overflow-hidden transition-[max-width,opacity] duration-300 ease-out"
        :class="status ? 'max-w-[min(260px,calc(100vw-8rem))] opacity-100' : 'max-w-0 opacity-0'"
        aria-live="polite"
      >
        <span v-if="status" class="flex items-center gap-2 whitespace-nowrap text-sm" :class="placement === 'fixed' ? 'pl-1 pr-3' : 'pl-3 pr-1'">
          <UIcon :name="status.icon || 'i-lucide-check'" class="size-4 shrink-0" />
          <span class="truncate">{{ status.text }}</span>
        </span>
      </div>

      <UButton
        v-if="status?.type === 'error' && status.retry"
        color="error"
        variant="link"
        size="sm"
        :label="t('userPill.retry')"
        @click="retry"
      />

      <UDropdownMenu
        :items="menuItems"
        :content="placement === 'fixed' ? { align: 'start', side: 'top' } : { align: 'end', side: 'bottom' }"
        :ui="{ content: 'w-72 sm:w-80' }"
        @update:open="onOpenChange"
      >
        <button
          type="button"
          class="relative flex h-11 min-w-11 items-center gap-2 rounded-full pl-1.5 pr-1.5 text-default focus-visible:outline-2 focus-visible:outline-primary"
          :class="showName && firstName ? 'sm:pr-3' : ''"
          :aria-label="t('userPill.accountAndStatus')"
        >
          <span class="relative">
            <UAvatar
              :src="isMember ? user?.image ?? undefined : undefined"
              :alt="displayName"
              :text="initial"
              size="md"
            />
            <span
              v-if="!isVisitor"
              class="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-default"
              :class="dotClass"
              aria-hidden="true"
            />
          </span>
          <span v-if="showName && firstName" class="max-w-28 truncate text-sm font-medium" :class="nameClass">
            {{ firstName }}
          </span>
          <UBadge
            v-if="isVisitor && showName"
            color="neutral"
            variant="outline"
            size="sm"
            :class="nameClass"
            :label="t('userPill.helper')"
          />
          <UBadge
            v-if="showStatus && unread > 0 && !status"
            color="warning"
            variant="solid"
            size="sm"
            :class="nameClass"
            :label="String(unread)"
          />
          <UIcon
            v-if="!isVisitor"
            name="i-lucide-chevron-down"
            class="size-4 text-muted"
            :class="nameClass"
          />
        </button>
      </UDropdownMenu>
    </div>
  </div>
</template>
