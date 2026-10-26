<script setup lang="ts">
import { localizeError } from '../../utils/errors'
/**
 * Team Delete Confirmation Component
 *
 * Modal/dialog to confirm team deletion.
 * Requires typing the team name to confirm.
 *
 * @example
 * ```vue
 * <TeamDeleteConfirm v-model:open="showDeleteModal" @deleted="onDeleted" />
 * ```
 */
interface Props {
  /** Whether the modal is open */
  open?: boolean
  /** External loading state */
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
  loading: false
})

const emit = defineEmits<{
  /** Emitted to update open state */
  'update:open': [value: boolean]
  /** Emitted when team is deleted */
  'deleted': []
  /** Emitted when deletion is cancelled */
  'cancel': []
}>()

const { t } = useT()
const { currentTeam, deleteTeam, isOwner, teams } = useTeam()
const notify = useNotify()

// Confirmation input
const confirmText = ref('')

// Internal loading state
const internalLoading = ref(false)
const isLoading = computed(() => props.loading || internalLoading.value)

// Check if confirmation matches team name
const isConfirmed = computed(() => {
  if (!currentTeam.value) return false
  return confirmText.value === currentTeam.value.name
})

// Handle close
function handleClose() {
  confirmText.value = ''
  emit('update:open', false)
  emit('cancel')
}

// Handle delete
async function handleDelete() {
  if (!isConfirmed.value || !isOwner.value) return

  internalLoading.value = true
  try {
    await deleteTeam()

    notify.success(t('teams.teamDeleted'), { description: t('teams.teamDeletedDescription') })

    confirmText.value = ''
    emit('update:open', false)
    emit('deleted')

    // Navigate to another team or home
    const nextTeam = teams.value[0]
    if (nextTeam) {
      await navigateTo(`/${nextTeam.slug}`)
    } else {
      await navigateTo('/')
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? localizeError(e, t) : t('teams.failedToDeleteTeam')
    notify.error(t('common.error'), { description: message })
  } finally {
    internalLoading.value = false
  }
}

// Reset on open
watch(
  () => props.open,
  (open) => {
    if (open) {
      confirmText.value = ''
    }
  }
)
</script>

<template>
  <UModal
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <div class="p-6 space-y-6">
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center size-10 rounded-full bg-error/10">
            <UIcon
              name="i-lucide-alert-triangle"
              class="size-5 text-error"
            />
          </div>
          <div>
            <h3 class="text-lg font-semibold">
              {{ t('teams.deleteTeam') }}
            </h3>
            <p class="text-sm text-muted">
              {{ t('confirmation.cannotUndo') }}
            </p>
          </div>
        </div>

        <UAlert
          color="error"
          variant="soft"
          icon="i-lucide-alert-circle"
        >
          <template #title>
            {{ t('teams.warning') }}
          </template>
          <template #description>
            <p>{{ t('teams.deleteTeamWillPrefix') }}</p>
            <ul class="list-disc list-inside mt-2 space-y-1">
              <li>{{ t('teams.deleteWillRemoveMembers') }}</li>
              <li>{{ t('teams.deleteWillCancelInvitations') }}</li>
              <li>{{ t('teams.deleteWillDeleteData') }}</li>
              <li>{{ t('teams.deleteIsPermanent') }}</li>
            </ul>
          </template>
        </UAlert>

        <UFormField name="confirmText">
          <template #label>
            {{ t('teams.typeToConfirmPrefix') }} <strong class="font-mono">{{ currentTeam?.name }}</strong> {{ t('teams.typeToConfirmSuffix') }}
          </template>
          <UInput
            v-model="confirmText"
            :placeholder="currentTeam?.name"
            :disabled="isLoading"
            class="font-mono w-full"
          />
        </UFormField>

        <div class="flex justify-end gap-3">
          <UButton
            variant="ghost"
            :disabled="isLoading"
            @click="handleClose"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="error"
            :loading="isLoading"
            :disabled="!isConfirmed"
            icon="i-lucide-trash-2"
            @click="handleDelete"
          >
            {{ t('teams.deleteTeam') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
