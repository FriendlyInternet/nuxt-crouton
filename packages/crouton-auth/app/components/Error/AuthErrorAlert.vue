<!--
  AuthErrorAlert Component

  Displays error messages in a consistent, user-friendly format.
  Supports dismissing, retrying, and different severity levels.

  @example
  <AuthErrorAlert
    :error="error"
    :dismissible="true"
    @dismiss="error = null"
    @retry="handleRetry"
  />
-->
<script setup lang="ts">
import { getErrorMessage, getErrorCode, AUTH_ERROR_CODES } from '../../utils/errors'

const { t } = useT()

interface Props {
  error: unknown
  title?: string
  dismissible?: boolean
  showRetry?: boolean
  variant?: 'error' | 'warning' | 'info'
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  dismissible: true,
  showRetry: false,
  variant: 'error'
})

const emit = defineEmits<{
  dismiss: []
  retry: []
}>()

const visible = ref(true)

const errorMessage = computed(() => getErrorMessage(props.error))
const errorCode = computed(() => getErrorCode(props.error))

const colorMap = {
  error: 'error' as const,
  warning: 'warning' as const,
  info: 'info' as const
}

const iconMap = {
  error: 'i-lucide-circle-alert',
  warning: 'i-lucide-triangle-alert',
  info: 'i-lucide-info'
}

// Determine if this is a network error that could benefit from retry
const isRetryable = computed(() => {
  const code = errorCode.value
  return (
    code === AUTH_ERROR_CODES.NETWORK_ERROR
    || code === AUTH_ERROR_CODES.NETWORK_TIMEOUT
    || code === AUTH_ERROR_CODES.SERVER_ERROR
  )
})

const handleDismiss = () => {
  visible.value = false
  emit('dismiss')
}

const handleRetry = () => {
  emit('retry')
}

// Reset visibility when error changes
watch(() => props.error, () => {
  if (props.error) {
    visible.value = true
  }
})
</script>

<template>
  <UAlert
    v-if="visible && error"
    :color="colorMap[variant]"
    :icon="iconMap[variant]"
    :title="title || undefined"
    :close-button="dismissible ? { icon: 'i-lucide-x', color: 'gray', variant: 'ghost' } : undefined"
    @close="handleDismiss"
  >
    <template #description>
      <div class="flex flex-col gap-2">
        <p>{{ errorMessage }}</p>
        <div
          v-if="showRetry && isRetryable"
          class="flex gap-2"
        >
          <UButton
            size="xs"
            variant="soft"
            :color="colorMap[variant]"
            @click="handleRetry"
          >
            {{ t('auth.magicLink.tryAgain') }}
          </UButton>
        </div>
      </div>
    </template>
  </UAlert>
</template>
