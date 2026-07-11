<script setup lang="ts">
/**
 * Two-click inline confirmation button.
 *
 * First click shows a confirm state ("Sure?"), second click fires @confirm.
 * Clicking anywhere else resets to the default state.
 *
 * @example
 * ```vue
 * <CroutonConfirmButton
 *   :label="t('teams.remove')"
 *   :confirm-label="t('teams.sure')"
 *   icon="i-lucide-user-x"
 *   :loading="isRemoving"
 *   @confirm="doRemove(member.id)"
 * />
 * ```
 */
interface Props {
  /** Default label text */
  label: string
  /** Label shown in confirmation state */
  confirmLabel?: string
  /** Icon shown in default state */
  icon?: string
  /** Show loading spinner (during async action) */
  loading?: boolean
  /** Disable the button */
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  confirmLabel: 'Sure?',
  icon: undefined,
  loading: false,
  disabled: false
})

const emit = defineEmits<{
  confirm: []
}>()

const confirming = ref(false)

function handleClick() {
  if (props.disabled) return
  if (confirming.value) {
    emit('confirm')
  } else {
    confirming.value = true
  }
}

// Click-away resets confirmation
function onDocumentClick() {
  if (confirming.value) {
    confirming.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})

// Reset when loading finishes (action completed)
watch(() => props.loading, (isLoading, wasLoading) => {
  if (wasLoading && !isLoading) {
    confirming.value = false
  }
})
</script>

<template>
  <!-- UButton (not raw) so themes reach it (#1410). Explicit error
       ghost→soft: quiet destructive chrome that fills as it arms. -->
  <UButton
    color="error"
    :variant="confirming ? 'soft' : 'ghost'"
    size="sm"
    :icon="confirming ? undefined : icon"
    :loading="loading && confirming"
    :disabled="disabled"
    class="shrink-0 whitespace-nowrap transition-all"
    @click.stop="handleClick"
  >
    {{ confirming ? confirmLabel : label }}
  </UButton>
</template>
