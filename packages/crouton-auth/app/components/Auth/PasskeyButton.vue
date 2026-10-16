<script setup lang="ts">
/**
 * PasskeyButton Component
 *
 * Button for passkey/WebAuthn authentication.
 * Checks browser support and passkey configuration.
 *
 * @example
 * ```vue
 * <AuthPasskeyButton @click="handlePasskey" />
 * ```
 */
interface Props {
  /** Show loading state */
  loading?: boolean
  /** Button text */
  text?: string
  /** Button variant */
  variant?: 'solid' | 'outline' | 'ghost' | 'soft'
  /** Button color */
  color?: 'primary' | 'neutral' | 'success' | 'warning' | 'error'
  /** Force show even if WebAuthn not supported (for display purposes) */
  forceShow?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  text: '',
  variant: 'outline',
  color: 'neutral',
  forceShow: false
})

const emit = defineEmits<{
  /** Emitted when button is clicked */
  click: []
}>()

const { t } = useT()
const { hasPasskeys, isWebAuthnSupported } = usePasskeys()

// Check if passkey is available
const isAvailable = computed(() => {
  if (props.forceShow) return true
  return hasPasskeys.value && isWebAuthnSupported()
})

// Handle button click
function handleClick() {
  emit('click')
}
</script>

<template>
  <UButton
    v-if="isAvailable"
    :color="color"
    :variant="variant"
    block
    icon="i-lucide-fingerprint"
    :loading="loading"
    @click="handleClick"
  >
    {{ text || t('auth.signInWithPasskey') }}
  </UButton>
</template>
