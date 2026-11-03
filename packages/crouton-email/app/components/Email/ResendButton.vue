<script setup lang="ts">
/**
 * ResendButton Component
 *
 * Timer-based resend button with cooldown functionality.
 * Shows countdown during cooldown, then allows resend.
 *
 * @example
 * ```vue
 * <EmailResendButton
 *   :cooldown="60"
 *   :loading="isResending"
 *   @resend="handleResend"
 * />
 * ```
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useIntervalFn } from '@vueuse/core'

const { t } = useT()

interface Props {
  /** Cooldown duration in seconds (default: 60) */
  cooldown?: number
  /** Loading state during resend */
  loading?: boolean
  /** Disabled state */
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  cooldown: 60,
  loading: false,
  disabled: false
})

const emit = defineEmits<{
  /** Emitted when button clicked and cooldown complete */
  resend: []
}>()

// Timer state
const remainingSeconds = ref(props.cooldown)
const isOnCooldown = computed(() => remainingSeconds.value > 0)

const { pause: pauseTimer, resume: resumeTimer } = useIntervalFn(
  () => {
    if (remainingSeconds.value > 0) {
      remainingSeconds.value--
    }
    if (remainingSeconds.value <= 0) {
      pauseTimer()
    }
  },
  1000,
  { immediate: false }
)

function startTimer() {
  remainingSeconds.value = props.cooldown
  resumeTimer()
}

function stopTimer() {
  pauseTimer()
}

// Handle resend click
function handleResend() {
  if (isOnCooldown.value || props.loading || props.disabled) return
  emit('resend')
  startTimer()
}

// Start timer on mount
onMounted(() => {
  startTimer()
})

// Restart timer when cooldown prop changes
watch(() => props.cooldown, () => {
  stopTimer()
  startTimer()
})

// Format remaining time
const formattedTime = computed(() => {
  const minutes = Math.floor(remainingSeconds.value / 60)
  const seconds = remainingSeconds.value % 60
  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }
  return `${seconds}s`
})

// Button text
const buttonText = computed(() => {
  if (props.loading) return t('email.sending')
  if (isOnCooldown.value) return t('email.resendIn', { time: formattedTime.value })
  return t('email.resend')
})

// Expose reset method for parent components
function reset() {
  stopTimer()
  remainingSeconds.value = 0
}

defineExpose({ reset, startTimer })
</script>

<template>
  <UButton
    variant="ghost"
    color="neutral"
    :loading="loading"
    :disabled="isOnCooldown || disabled"
    icon="i-lucide-refresh-cw"
    @click="handleResend"
  >
    {{ buttonText }}
  </UButton>
</template>
