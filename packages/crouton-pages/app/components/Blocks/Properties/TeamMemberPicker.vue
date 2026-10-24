<script setup lang="ts">
/**
 * Team Member Picker for Block Properties
 *
 * Loads team members and provides a searchable select to pick one.
 * Returns the member's userId as the model value.
 */

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:memberData': [data: { firstName?: string; lastName?: string; email?: string; avatar?: string }]
}>()

const { members, loadMembers } = useTeam()
const { t } = useT()

// Load members on mount
const loading = ref(true)
onMounted(async () => {
  await loadMembers()
  loading.value = false
})

// Build select items from members
interface MemberSelectItem {
  label: string
  value: string
  avatar?: string
  email: string
}

const memberItems = computed<MemberSelectItem[]>(() => {
  return members.value
    .filter(m => 'user' in m && m.user)
    .map((m) => {
      const member = m as { userId: string; role: string; user: { id: string; name?: string | null; email: string; image?: string | null } }
      const name = member.user.name || member.user.email
      return {
        label: name,
        value: member.userId,
        avatar: member.user.image || undefined,
        email: member.user.email
      }
    })
})

// Find selected member for display
const selectedMember = computed(() => {
  return memberItems.value.find(m => m.value === props.modelValue)
})

function onMemberSelected(userId: string) {
  emit('update:modelValue', userId)
  // Denormalize member data so public pages can render without auth API
  const member = memberItems.value.find(m => m.value === userId)
  if (member) {
    const nameParts = (member.label || '').split(' ')
    emit('update:memberData', {
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
      email: member.email,
      avatar: member.avatar
    })
  }
}
</script>

<template>
  <div class="space-y-2">
    <USelectMenu
      :model-value="modelValue"
      :items="(memberItems as any[])"
      value-key="value"
      :loading="loading"
      :placeholder="t('pages.blockEditors.teamMemberPlaceholder')"
      searchable
      class="w-full"
      @update:model-value="onMemberSelected"
    >
      <template #leading>
        <UAvatar
          v-if="selectedMember?.avatar"
          :src="selectedMember.avatar"
          size="3xs"
        />
        <UIcon
          v-else
          name="i-lucide-user"
          class="size-4 text-muted"
        />
      </template>
      <template #item="{ item: rawItem }">
        <div class="flex items-center gap-2">
          <UAvatar
            :src="(rawItem as any)?.avatar"
            :text="((rawItem as any)?.label || '?').slice(0, 2).toUpperCase()"
            size="2xs"
          />
          <div class="min-w-0">
            <p class="text-sm font-medium truncate">{{ (rawItem as any)?.label }}</p>
            <p v-if="(rawItem as any)?.email !== (rawItem as any)?.label" class="text-xs text-muted truncate">{{ (rawItem as any)?.email }}</p>
          </div>
        </div>
      </template>
    </USelectMenu>

    <!-- Preview selected member -->
    <div
      v-if="selectedMember"
      class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/30 text-sm"
    >
      <UAvatar
        :src="selectedMember.avatar"
        :text="(selectedMember.label || '?').slice(0, 2).toUpperCase()"
        size="xs"
      />
      <div class="min-w-0">
        <p class="font-medium truncate">{{ selectedMember.label }}</p>
        <p v-if="selectedMember.email !== selectedMember.label" class="text-xs text-muted truncate">{{ selectedMember.email }}</p>
      </div>
    </div>
  </div>
</template>
