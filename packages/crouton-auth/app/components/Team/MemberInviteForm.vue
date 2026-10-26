<script setup lang="ts">
import { localizeError } from '../../utils/errors'
/**
 * Team Member Invite Form Component
 *
 * Form to invite a new member to the team.
 * Allows setting the role for the invitation.
 *
 * @example
 * ```vue
 * <TeamMemberInviteForm @success="onInvited" @cancel="closeModal" />
 * ```
 */
import type { FormSubmitEvent, FormError } from '@nuxt/ui'
import type { MemberRole } from '../../../types'

const { t } = useT()

interface Props {
  /** External loading state */
  loading?: boolean
  /** External error message */
  error?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  error: null
})

const emit = defineEmits<{
  /** Emitted when invitation is sent successfully */
  success: [email: string, role: MemberRole]
  /** Emitted when form is submitted */
  submit: [data: { email: string, role: MemberRole }]
  /** Emitted when cancel is clicked */
  cancel: []
}>()

const { inviteMember, canInviteMembers, isOwner } = useTeam()
const notify = useNotify()

// Form state
const state = reactive({
  email: '',
  role: 'member' as MemberRole
})

// Role options
const roleOptions = computed(() => {
  const roles: Array<{ label: string, value: MemberRole, description: string }> = [
    {
      label: t('teams.member'),
      value: 'member',
      description: t('teams.inviteForm.memberRoleDescription')
    },
    {
      label: t('teams.admin'),
      value: 'admin',
      description: t('teams.inviteForm.adminRoleDescription')
    }
  ]

  // Only owner can invite other owners
  if (isOwner.value) {
    roles.push({
      label: t('teams.owner'),
      value: 'owner',
      description: t('teams.inviteForm.ownerRoleDescription')
    })
  }

  return roles
})

// Validation
function validate(formState: Partial<typeof state>): FormError[] {
  const errors: FormError[] = []

  if (!formState.email?.trim()) {
    errors.push({ name: 'email', message: t('errors.requiredField') })
  } else if (!/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(formState.email)) {
    errors.push({ name: 'email', message: t('errors.invalidEmail') })
  }

  return errors
}

// Internal loading state
const internalLoading = ref(false)
const isLoading = computed(() => props.loading || internalLoading.value)

// Handle form submission
async function onSubmit(event: FormSubmitEvent<typeof state>) {
  emit('submit', { email: event.data.email, role: event.data.role })

  if (!canInviteMembers.value) {
    notify.error(t('teams.permissionDenied'), { description: t('teams.inviteForm.noPermission') })
    return
  }

  internalLoading.value = true
  try {
    await inviteMember({
      email: event.data.email,
      role: event.data.role
    })

    notify.success(t('teams.inviteForm.sent'), { description: t('teams.inviteForm.sentDescription', { email: event.data.email }) })

    emit('success', event.data.email, event.data.role)

    // Reset form
    state.email = ''
    state.role = 'member'
  } catch (e: unknown) {
    const message = e instanceof Error ? localizeError(e, t) : t('teams.inviteForm.failedToSend')
    notify.error(t('common.error'), { description: message })
  } finally {
    internalLoading.value = false
  }
}
</script>

<template>
  <UForm
    :validate="validate"
    :state="state"
    class="space-y-6"
    @submit="onSubmit"
  >
    <div>
      <h3 class="text-lg font-semibold">
        {{ t('teams.inviteMember') }}
      </h3>
      <p class="text-sm text-muted mt-1">
        {{ t('teams.inviteForm.description') }}
      </p>
    </div>

    <UFormField
      :label="t('auth.email')"
      name="email"
      required
    >
      <UInput
        v-model="state.email"
        type="email"
        placeholder="colleague@example.com"
        icon="i-lucide-mail"
        :disabled="isLoading"
        class="w-full"
      />
    </UFormField>

    <UFormField
      :label="t('teams.role')"
      name="role"
    >
      <template #hint>
        <span class="text-xs text-muted">
          {{ t('teams.inviteForm.roleHint') }}
        </span>
      </template>
      <URadioGroup
        v-model="state.role"
        :items="roleOptions"
        :disabled="isLoading"
      >
        <template #label="{ item }">
          <div>
            <p class="font-medium">
              {{ item.label }}
            </p>
            <p class="text-xs text-muted">
              {{ item.description }}
            </p>
          </div>
        </template>
      </URadioGroup>
    </UFormField>

    <!-- Error Alert -->
    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-alert-circle"
      :title="error"
    />

    <div class="flex justify-end gap-3">
      <UButton
        variant="ghost"
        :disabled="isLoading"
        @click="emit('cancel')"
      >
        {{ t('common.cancel') }}
      </UButton>
      <UButton
        type="submit"
        :loading="isLoading"
        icon="i-lucide-send"
      >
        {{ t('teams.invite') }}
      </UButton>
    </div>
  </UForm>
</template>
