<!--
  AuthGuard Component

  Prevents flash of unauthenticated content (FOUC) by showing a loading
  state until the auth session has been resolved.

  Use this to wrap authenticated content that should not flash before
  the auth state is known.

  @example
  <AuthGuard>
    <template #loading>
      <AuthSkeleton type="profile" />
    </template>
    <template #default>
      <AccountSettings />
    </template>
  </AuthGuard>

  @example
  <AuthGuard redirect="/auth/login">
    <DashboardContent />
  </AuthGuard>
-->
<script setup lang="ts">
const { t } = useT()

interface Props {
  /** Redirect to this path if not authenticated */
  redirect?: string
  /** Show loading state during SSR */
  showSsrLoader?: boolean
  /** Require authentication (default: true) */
  requireAuth?: boolean
  /** Minimum loading time in ms (prevents flash) */
  minLoadingTime?: number
}

const props = withDefaults(defineProps<Props>(), {
  redirect: '',
  showSsrLoader: true,
  requireAuth: true,
  minLoadingTime: 100
})

const _slots = defineSlots<{
  default: () => any
  loading: () => any
  unauthenticated: () => any
}>()

const { isAuthenticated, isPending } = useSession()
const router = useRouter()

// Track if we've shown loading for minimum time
const minTimeElapsed = ref(false)

// Start timer on mount
onMounted(() => {
  if (props.minLoadingTime > 0) {
    setTimeout(() => {
      minTimeElapsed.value = true
    }, props.minLoadingTime)
  } else {
    minTimeElapsed.value = true
  }
})

// Computed loading state
const isLoading = computed(() => {
  // During SSR, show loading if configured
  if (import.meta.server && props.showSsrLoader) {
    return true
  }

  // Still pending auth check
  if (isPending.value) {
    return true
  }

  // Minimum time hasn't elapsed
  if (!minTimeElapsed.value) {
    return true
  }

  return false
})

// Handle redirect if not authenticated
watch(
  [isAuthenticated, isPending],
  ([authenticated, pending]) => {
    if (!pending && !authenticated && props.requireAuth && props.redirect) {
      router.push(props.redirect)
    }
  },
  { immediate: true }
)

// Determine what to show
const showContent = computed(() => {
  if (isLoading.value) return 'loading'
  if (props.requireAuth && !isAuthenticated.value) return 'unauthenticated'
  return 'content'
})
</script>

<template>
  <ClientOnly>
    <template #fallback>
      <slot
        v-if="showSsrLoader"
        name="loading"
      >
        <div class="flex items-center justify-center p-8">
          <UIcon
            name="i-lucide-refresh-cw"
            class="w-6 h-6 animate-spin text-gray-400"
          />
        </div>
      </slot>
    </template>

    <slot
      v-if="showContent === 'loading'"
      name="loading"
    >
      <div class="flex items-center justify-center p-8">
        <UIcon
          name="i-lucide-refresh-cw"
          class="w-6 h-6 animate-spin text-gray-400"
        />
      </div>
    </slot>

    <slot
      v-else-if="showContent === 'unauthenticated'"
      name="unauthenticated"
    >
      <div class="flex flex-col items-center justify-center p-8 text-center">
        <UIcon
          name="i-lucide-lock"
          class="w-12 h-12 text-gray-400 mb-4"
        />
        <p class="text-gray-600 dark:text-gray-400">
          {{ t('auth.signInToAccess') }}
        </p>
      </div>
    </slot>

    <slot v-else />
  </ClientOnly>
</template>
