<script setup lang="ts">
/**
 * Team Roles Settings (#4106)
 *
 * Lists the fixed base roles (owner, member — read-only), the team's admin
 * role (#4130: one row per team, edited by the owner only, read-only for
 * everyone else, never deleted) and the team's own roles. A team role is a name plus ticked actions, grouped per package.
 * Create / edit (actions only — the name is fixed once members can hold it) /
 * delete (Better Auth refuses while a member still has the role).
 *
 * Better Auth only lets you give a role actions you hold yourself, so actions
 * you lack are shown disabled, and a role holding one opens read-only.
 */
const { t } = useT()
const notify = useNotify()
const appConfig = useAppConfig() as { croutonActions?: Record<string, { label?: string } | undefined> }
const runtime = useRuntimeConfig() as { public?: { crouton?: { auth?: { teams?: { roles?: Record<string, string[] | undefined> } } } } }

const {
  baseRoles: BASE_ROLES,
  roleEditState,
  validateRoleName,
  roles,
  adminRole,
  grantable,
  registeredActions,
  loading,
  refresh,
  create,
  update,
  updateAdmin,
  remove
} = useTeamRoles()
const { isOwner } = useTeam()

onMounted(async () => {
  const { error } = await refresh()
  if (error) notify.error(t('errors.generic') || 'Error', { description: error.message })
})

function tr(key: string, fallback: string): string {
  const v = t(key)
  return v && v !== key ? v : fallback
}

function actionLabel(action: string): string {
  const key = appConfig.croutonActions?.[action]?.label
  return key ? tr(key, action) : action
}

/** Registered actions grouped by the part before `:` (one group per package area). */
const groups = computed(() => {
  const byResource = new Map<string, string[]>()
  for (const action of registeredActions.value) {
    const resource = action.slice(0, action.indexOf(':'))
    const list = byResource.get(resource) ?? []
    list.push(action)
    byResource.set(resource, list)
  }
  return [...byResource.entries()].map(([resource, actions]) => ({
    resource,
    label: tr(`teams.rolesScreen.groups.${resource}`, resource),
    actions
  }))
})

/** What a base role gets from the site config, or the defaults (owner/admin all, member none). */
function configuredActions(role: string): string[] {
  const configured = runtime.public?.crouton?.auth?.teams?.roles?.[role]
  const all = registeredActions.value
  return configured ? configured.filter(a => all.includes(a)) : role === 'member' ? [] : all
}

/** The fixed roles: owner and member. */
const baseRoles = computed(() => BASE_ROLES
  .filter(role => role !== 'admin')
  .map(role => ({ role, label: tr(`teams.${role}`, role), actions: configuredActions(role) })))

/** The team's admin role: its stored row, or the config template until the row loads. */
const admin = computed(() => ({
  role: 'admin',
  label: tr('teams.admin', 'admin'),
  actions: adminRole.value?.actions ?? configuredActions('admin')
}))

function summary(actions: string[]): string {
  if (actions.length === 0) return tr('teams.rolesScreen.noActions', 'No actions')
  if (actions.length === registeredActions.value.length) return tr('teams.rolesScreen.allActions', 'All actions')
  return actions.map(actionLabel).join(', ')
}

function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'ROLE_IS_ASSIGNED_TO_MEMBERS':
      return tr('teams.rolesScreen.deleteAssigned', 'This role is still given to a member — take it off them first')
    case 'ROLE_NAME_IS_ALREADY_TAKEN':
      return tr('teams.rolesScreen.nameTaken', 'That name already exists')
    case 'ADMIN_ROLE_OWNER_ONLY':
      return tr('teams.rolesScreen.adminOwnerOnly', 'Only the owner can change this role')
    case 'ADMIN_ROLE_CANNOT_BE_DELETED':
      return tr('teams.rolesScreen.adminCannotDelete', 'The admin role cannot be deleted')
    case 'ADMIN_ROLE_CANNOT_BE_RENAMED':
      return tr('teams.rolesScreen.adminCannotRename', 'The admin role cannot be renamed')
    case 'YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE':
    case 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_A_ROLE':
      return tr('teams.rolesScreen.notYoursHint', 'You can only give actions you have yourself')
    default:
      return fallback
  }
}

// ── Create / edit modal ─────────────────────────────────────────────────────
const editorOpen = ref(false)
const editing = ref<string | null>(null) // role name when editing, null when creating
const form = reactive<{ name: string, actions: string[] }>({ name: '', actions: [] })
const saving = ref(false)
const nameTouched = ref(false)

const editState = computed(() => roleEditState(editing.value ? form.actions : [], grantable.value))
const readOnly = computed(() => !!editing.value && editState.value.readOnly)
const hasLocked = computed(() => editState.value.lockedActions.length > 0)

const nameProblem = computed(() => (editing.value ? null : validateRoleName(form.name)))
const nameError = computed(() => {
  if (!nameTouched.value || !nameProblem.value) return undefined
  return nameProblem.value === 'base'
    ? tr('teams.rolesScreen.nameTaken', 'That name already exists')
    : tr('teams.rolesScreen.nameInvalid', 'Give a name of 1 to 40 characters, without a comma')
})

function checkboxItems(actions: string[]) {
  const locked = new Set(editState.value.lockedActions)
  return actions.map(action => ({
    label: actionLabel(action),
    value: action,
    disabled: readOnly.value || locked.has(action)
  }))
}

/** The ticked actions of one group. */
function groupValue(actions: string[]): string[] {
  return form.actions.filter(a => actions.includes(a))
}

/** Replace one group's ticks in `form.actions`. */
function setGroup(actions: string[], picked: unknown) {
  const list = Array.isArray(picked) ? picked.filter((v): v is string => typeof v === 'string') : []
  form.actions = [...form.actions.filter(a => !actions.includes(a)), ...list]
}

function openCreate() {
  editing.value = null
  form.name = ''
  form.actions = []
  nameTouched.value = false
  editorOpen.value = true
}

function openEdit(role: { role: string, actions: string[] }) {
  editing.value = role.role
  form.name = role.role
  form.actions = [...role.actions]
  nameTouched.value = false
  editorOpen.value = true
}

async function save() {
  if (readOnly.value) return
  nameTouched.value = true
  if (nameProblem.value) return
  saving.value = true
  const result = editing.value === 'admin'
    ? await updateAdmin(form.actions)
    : editing.value
      ? await update(editing.value, form.actions)
      : await create(form.name, form.actions)
  saving.value = false
  if (result.error) {
    notify.error(t('errors.generic') || 'Error', { description: errorText(result.error.code, result.error.message) })
    return
  }
  notify.success(t('common.saved') || 'Saved')
  editorOpen.value = false
}

// ── Delete ──────────────────────────────────────────────────────────────────
const deleteOpen = ref(false)
const deleting = ref<string | null>(null)
const removing = ref(false)

function askDelete(name: string) {
  deleting.value = name
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!deleting.value) return
  removing.value = true
  const result = await remove(deleting.value)
  removing.value = false
  deleteOpen.value = false
  if (result.error) {
    notify.error(t('errors.generic') || 'Error', { description: errorText(result.error.code, result.error.message) })
    return
  }
  notify.success(tr('teams.rolesScreen.deleted', 'Role deleted'))
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">
          {{ tr('teams.rolesScreen.title', 'Roles') }}
        </h2>
        <p class="text-sm text-muted">
          {{ tr('teams.rolesScreen.description', 'Who may do what in this team.') }}
        </p>
      </div>
      <UButton
        icon="i-lucide-plus"
        :label="tr('teams.rolesScreen.new', 'New role')"
        @click="openCreate"
      />
    </div>

    <!-- Base roles: fixed, read-only -->
    <div class="space-y-2">
      <UCard
        v-for="base in baseRoles"
        :key="base.role"
        :ui="{ body: 'p-3 sm:p-4' }"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium capitalize">{{ base.label }}</span>
          <UBadge
            color="neutral"
            variant="subtle"
            size="sm"
            icon="i-lucide-lock"
            :label="tr('teams.rolesScreen.fixed', 'Fixed')"
          />
        </div>
        <p class="mt-1 text-sm text-muted">
          {{ summary(base.actions) }}
        </p>
      </UCard>
    </div>

    <!-- The team's admin role: the owner edits it, nobody deletes it (#4130) -->
    <UCard :ui="{ body: 'p-3 sm:p-4' }">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <span class="font-medium capitalize">{{ admin.label }}</span>
          <p class="mt-1 text-sm text-muted">
            {{ summary(admin.actions) }}
          </p>
          <p
            v-if="!isOwner"
            class="mt-1 flex items-center gap-1 text-xs text-muted"
          >
            <UIcon
              name="i-lucide-lock"
              class="size-3"
            />
            {{ tr('teams.rolesScreen.adminOwnerOnly', 'Only the owner can change this role') }}
          </p>
        </div>
        <UButton
          v-if="isOwner"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-pencil"
          :label="tr('teams.rolesScreen.edit', 'Edit')"
          @click="openEdit(admin)"
        />
      </div>
    </UCard>

    <!-- The team's own roles -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-muted">
        {{ tr('teams.rolesScreen.teamRoles', 'Roles of this team') }}
      </h3>
      <p
        v-if="!loading && roles.length === 0"
        class="text-sm text-muted"
      >
        {{ tr('teams.rolesScreen.empty', 'No team roles yet.') }}
      </p>
      <UCard
        v-for="role in roles"
        :key="role.id"
        :ui="{ body: 'p-3 sm:p-4' }"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <span class="font-medium">{{ role.role }}</span>
            <p class="mt-1 text-sm text-muted">
              {{ summary(role.actions) }}
            </p>
          </div>
          <div class="flex gap-1">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-pencil"
              :label="tr('teams.rolesScreen.edit', 'Edit')"
              @click="openEdit(role)"
            />
            <UButton
              color="error"
              variant="ghost"
              size="sm"
              icon="i-lucide-trash-2"
              :label="tr('teams.rolesScreen.delete', 'Delete')"
              @click="askDelete(role.role)"
            />
          </div>
        </div>
      </UCard>
    </div>

    <!-- Create / edit -->
    <UModal
      v-model:open="editorOpen"
      :title="editing ? editing : tr('teams.rolesScreen.new', 'New role')"
    >
      <template #body>
        <div class="space-y-4">
          <UAlert
            v-if="readOnly"
            color="warning"
            variant="subtle"
            icon="i-lucide-lock"
            :description="tr('teams.rolesScreen.readOnlyRole', 'This role has actions you do not have — only someone who has them can change it')"
          />
          <UFormField
            :label="tr('teams.rolesScreen.name', 'Name')"
            :error="nameError"
          >
            <UInput
              v-model="form.name"
              class="w-full"
              :disabled="!!editing"
              :maxlength="40"
              @blur="nameTouched = true"
            />
          </UFormField>

          <p class="text-xs text-muted">
            {{ tr('teams.rolesScreen.adminAccessHint', 'A role with any action also opens the admin area.') }}
          </p>
          <p
            v-if="hasLocked && !readOnly"
            class="text-xs text-muted"
          >
            {{ tr('teams.rolesScreen.notYoursHint', 'You can only give actions you have yourself') }}
          </p>

          <div
            v-for="group in groups"
            :key="group.resource"
            class="space-y-1"
          >
            <p class="text-sm font-medium">
              {{ group.label }}
            </p>
            <UCheckboxGroup
              :model-value="groupValue(group.actions)"
              :items="checkboxItems(group.actions)"
              @update:model-value="setGroup(group.actions, $event)"
            />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :label="tr('common.cancel', 'Cancel')"
            @click="editorOpen = false"
          />
          <UButton
            v-if="!readOnly"
            :loading="saving"
            :label="tr('common.save', 'Save')"
            @click="save"
          />
        </div>
      </template>
    </UModal>

    <!-- Delete confirm -->
    <UModal
      v-model:open="deleteOpen"
      :title="tr('teams.rolesScreen.delete', 'Delete')"
      :description="tr('teams.rolesScreen.deleteConfirm', 'Delete this role? This cannot be undone.')"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :label="tr('common.cancel', 'Cancel')"
            @click="deleteOpen = false"
          />
          <UButton
            color="error"
            :loading="removing"
            :label="tr('teams.rolesScreen.delete', 'Delete')"
            @click="confirmDelete"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
