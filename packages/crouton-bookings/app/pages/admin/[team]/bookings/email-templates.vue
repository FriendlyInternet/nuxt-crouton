<script setup lang="ts">
const { teamId } = useTeamContext()
const { t } = useT()
const { hasApp } = useCroutonApps()
const hasAI = hasApp('ai')

// Get booking email variables and preview values
const { variables, getPreviewValues } = useBookingEmailVariables()
const previewValues = getPreviewValues()

// Strings with {{ (defined here to avoid Vue template parsing issues)
const editorPlaceholder = computed(() => t('bookings.emailTemplates.editorPlaceholder'))
const subjectPlaceholder = computed(() => t('bookings.emailTemplates.subjectPlaceholder'))
const variableHint = computed(() => t('bookings.emailTemplates.variableHint'))

// Available locales for translations
const locales = [
  { code: 'en', label: 'EN', required: true },
  { code: 'nl', label: 'NL', required: false },
  { code: 'fr', label: 'FR', required: false }
]
const activeLocale = ref('en')

// Modal state
const showForm = ref(false)
const editingTemplate = ref<any>(null)
const formAction = ref<'create' | 'update'>('create')

// Fetch templates
const { data: templates, refresh, status } = await useFetch(
  () => `/api/teams/${teamId.value}/bookings-emailtemplates`,
  {
    key: `email-templates-${teamId.value}`
  }
)

// Fetch locations for the select
const { data: locations } = await useFetch(
  () => `/api/teams/${teamId.value}/bookings-locations`,
  {
    key: `locations-${teamId.value}`
  }
)

// Location options for select
const locationOptions = computed(() => {
  const items = Array.isArray(locations.value) ? locations.value : locations.value?.items || []
  return [
    { label: t('bookings.emailTemplates.allLocations'), value: null },
    ...items.map((loc: any) => ({
      label: loc.name || loc.title || loc.id,
      value: loc.id
    }))
  ]
})

// Group templates by trigger type
const templatesByTrigger = computed(() => {
  const grouped: Record<string, any[]> = {
    booking_created: [],
    reminder_before: [],
    booking_cancelled: [],
    follow_up_after: []
  }

  // API returns array directly
  const items = Array.isArray(templates.value) ? templates.value : (templates.value as { items?: any[] } | null)?.items || []
  for (const template of items) {
    const trigger = template.triggerType || 'booking_created'
    if (grouped[trigger]) {
      grouped[trigger].push(template)
    }
  }

  return grouped
})

// Trigger type labels and icons
const triggerConfig = computed(() => ({
  booking_created: {
    label: t('bookings.emailTemplates.triggers.bookingCreated'),
    description: t('bookings.emailTemplates.triggers.bookingCreatedDesc'),
    icon: 'i-lucide-calendar-plus',
    color: 'success' as const
  },
  reminder_before: {
    label: t('bookings.emailTemplates.triggers.reminderBefore'),
    description: t('bookings.emailTemplates.triggers.reminderBeforeDesc'),
    icon: 'i-lucide-bell',
    color: 'warning' as const
  },
  booking_cancelled: {
    label: t('bookings.emailTemplates.triggers.bookingCancelled'),
    description: t('bookings.emailTemplates.triggers.bookingCancelledDesc'),
    icon: 'i-lucide-calendar-x',
    color: 'error' as const
  },
  follow_up_after: {
    label: t('bookings.emailTemplates.triggers.followUpAfter'),
    description: t('bookings.emailTemplates.triggers.followUpAfterDesc'),
    icon: 'i-lucide-mail-check',
    color: 'info' as const
  }
}))

// Form state with translations support
const formState = ref({
  // English (default) values
  name: '',
  subject: '',
  body: '',
  // Translations for other locales
  translations: {} as Record<string, { name?: string; subject?: string; body?: string }>,
  // Other fields
  fromEmail: '',
  triggerType: 'booking_created',
  recipientType: 'customer',
  isActive: true,
  daysOffset: 0,
  locationId: null as string | null
})

// Get/set translated field value
function getFieldValue(field: 'name' | 'subject' | 'body') {
  if (activeLocale.value === 'en') {
    return formState.value[field]
  }
  return formState.value.translations[activeLocale.value]?.[field] || ''
}

function setFieldValue(field: 'name' | 'subject' | 'body', value: string) {
  if (activeLocale.value === 'en') {
    formState.value[field] = value
  } else {
    if (!formState.value.translations[activeLocale.value]) {
      formState.value.translations[activeLocale.value] = {}
    }
    formState.value.translations[activeLocale.value]![field] = value
  }
}

// Computed properties for v-model binding
const nameValue = computed({
  get: () => getFieldValue('name'),
  set: (v) => setFieldValue('name', v)
})

const subjectValue = computed({
  get: () => getFieldValue('subject'),
  set: (v) => setFieldValue('subject', v)
})

const bodyValue = computed({
  get: () => getFieldValue('body'),
  set: (v) => setFieldValue('body', v)
})

// Check if translation exists for locale
function hasTranslation(locale: string): boolean {
  if (locale === 'en') {
    return !!(formState.value.name || formState.value.subject || formState.value.body)
  }
  const trans = formState.value.translations[locale]
  return !!(trans?.name || trans?.subject || trans?.body)
}

// Open form for create
function openCreateForm(triggerType: string) {
  formAction.value = 'create'
  editingTemplate.value = null
  activeLocale.value = 'en'
  formState.value = {
    name: '',
    subject: '',
    body: '',
    translations: {},
    fromEmail: '',
    triggerType,
    recipientType: 'customer',
    isActive: true,
    daysOffset: 0,
    locationId: null
  }
  showForm.value = true
}

// Open form for edit
function openEditForm(template: any) {
  formAction.value = 'update'
  editingTemplate.value = template
  activeLocale.value = 'en'
  formState.value = {
    name: template.name || '',
    subject: template.subject || '',
    body: template.body || '',
    translations: template.translations || {},
    fromEmail: template.fromEmail || '',
    triggerType: template.triggerType || 'booking_created',
    recipientType: template.recipientType || 'customer',
    isActive: template.isActive ?? true,
    daysOffset: template.daysOffset || 0,
    locationId: template.locationId || null
  }
  showForm.value = true
}

// Submit form
const submitting = ref(false)

async function handleSubmit() {
  submitting.value = true

  try {
    // Clean up empty translations
    const cleanedTranslations: Record<string, any> = {}
    for (const [locale, trans] of Object.entries(formState.value.translations)) {
      if (trans.name || trans.subject || trans.body) {
        cleanedTranslations[locale] = trans
      }
    }

    const payload = {
      ...formState.value,
      translations: Object.keys(cleanedTranslations).length > 0 ? cleanedTranslations : undefined
    }

    if (formAction.value === 'create') {
      await $fetch(`/api/teams/${teamId.value}/bookings-emailtemplates`, {
        method: 'POST',
        body: payload
      })
    } else if (editingTemplate.value?.id) {
      await $fetch(`/api/teams/${teamId.value}/bookings-emailtemplates/${editingTemplate.value.id}`, {
        method: 'PATCH',
        body: payload
      })
    }

    showForm.value = false
    await refresh()
  } catch (error) {
    console.error('Failed to save template:', error)
  } finally {
    submitting.value = false
  }
}

// Delete template
async function deleteTemplate(template: any) {
  if (!confirm(t('bookings.emailTemplates.deleteConfirm'))) return

  try {
    await $fetch(`/api/teams/${teamId.value}/bookings-emailtemplates/${template.id}`, {
      method: 'DELETE'
    })
    await refresh()
  } catch (error) {
    console.error('Failed to delete template:', error)
  }
}

// Toggle template active status
async function toggleActive(template: any) {
  try {
    await $fetch(`/api/teams/${teamId.value}/bookings-emailtemplates/${template.id}`, {
      method: 'PATCH',
      body: { isActive: !template.isActive }
    })
    await refresh()
  } catch (error) {
    console.error('Failed to toggle template:', error)
  }
}

// AI generation
const generating = ref(false)

async function generateWithAI() {
  generating.value = true
  try {
    const result = await $fetch<{ name: string; subject: string; body: string }>('/api/ai/generate-email-template', {
      method: 'POST',
      body: {
        triggerType: formState.value.triggerType,
        recipientType: formState.value.recipientType,
        locale: activeLocale.value
      }
    })
    setFieldValue('name', result.name)
    setFieldValue('subject', result.subject)
    setFieldValue('body', result.body)
  }
  catch (error) {
    console.error('Failed to generate email template:', error)
  }
  finally {
    generating.value = false
  }
}

// Get location name for display
function getLocationName(locationId: string | null) {
  if (!locationId) return t('bookings.emailTemplates.allLocations')
  const items = Array.isArray(locations.value) ? locations.value : locations.value?.items || []
  const loc = items.find((l: any) => l.id === locationId)
  return loc?.name || loc?.title || locationId
}
</script>

<template>
  <div class="p-4 sm:p-6 space-y-8">
    <!-- Page Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">{{ t('bookings.emailTemplates.title') }}</h1>
        <p class="text-muted mt-1">{{ t('bookings.emailTemplates.description') }}</p>
      </div>
      <UDropdownMenu
        :items="[
          { label: t('bookings.emailTemplates.triggers.bookingCreated'), icon: 'i-lucide-calendar-plus', onSelect: () => openCreateForm('booking_created') },
          { label: t('bookings.emailTemplates.triggers.reminderBefore'), icon: 'i-lucide-bell', onSelect: () => openCreateForm('reminder_before') },
          { label: t('bookings.emailTemplates.triggers.bookingCancelled'), icon: 'i-lucide-calendar-x', onSelect: () => openCreateForm('booking_cancelled') },
          { label: t('bookings.emailTemplates.triggers.followUpAfter'), icon: 'i-lucide-mail-check', onSelect: () => openCreateForm('follow_up_after') }
        ]"
      >
        <UButton icon="i-lucide-plus" color="primary">
          {{ t('bookings.emailTemplates.newTemplate') }}
        </UButton>
      </UDropdownMenu>
    </div>
        <!-- Loading state -->
        <div v-if="status === 'pending'" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted" />
        </div>

        <!-- Templates by trigger type -->
        <div v-else class="space-y-8">
          <div
            v-for="(triggerTemplates, triggerType) in templatesByTrigger"
            :key="triggerType"
            class="space-y-4"
          >
            <!-- Trigger header -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div
                  class="flex size-10 items-center justify-center rounded-lg"
                  :class="{
                    'bg-success/10': triggerConfig[triggerType as keyof typeof triggerConfig]?.color === 'success',
                    'bg-warning/10': triggerConfig[triggerType as keyof typeof triggerConfig]?.color === 'warning',
                    'bg-error/10': triggerConfig[triggerType as keyof typeof triggerConfig]?.color === 'error',
                    'bg-info/10': triggerConfig[triggerType as keyof typeof triggerConfig]?.color === 'info'
                  }"
                >
                  <UIcon
                    :name="triggerConfig[triggerType as keyof typeof triggerConfig]?.icon || 'i-lucide-mail'"
                    class="size-5"
                    :class="{
                      'text-success': triggerConfig[triggerType as keyof typeof triggerConfig]?.color === 'success',
                      'text-warning': triggerConfig[triggerType as keyof typeof triggerConfig]?.color === 'warning',
                      'text-error': triggerConfig[triggerType as keyof typeof triggerConfig]?.color === 'error',
                      'text-info': triggerConfig[triggerType as keyof typeof triggerConfig]?.color === 'info'
                    }"
                  />
                </div>
                <div>
                  <h3 class="font-semibold">
                    {{ triggerConfig[triggerType as keyof typeof triggerConfig]?.label || triggerType }}
                  </h3>
                  <p class="text-sm text-muted">
                    {{ triggerConfig[triggerType as keyof typeof triggerConfig]?.description }}
                  </p>
                </div>
              </div>
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-plus"
                @click="openCreateForm(triggerType)"
              >
                {{ t('bookings.emailTemplates.add') }}
              </UButton>
            </div>

            <!-- Template cards -->
            <div v-if="triggerTemplates.length > 0" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <UCard
                v-for="template in triggerTemplates"
                :key="template.id"
                class="relative"
              >
                <!-- Active badge -->
                <UBadge
                  v-if="template.isActive"
                  color="success"
                  variant="subtle"
                  size="xs"
                  class="absolute top-3 right-3"
                >
                  {{ t('bookings.emailTemplates.active') }}
                </UBadge>
                <UBadge
                  v-else
                  color="neutral"
                  variant="subtle"
                  size="xs"
                  class="absolute top-3 right-3"
                >
                  {{ t('bookings.emailTemplates.inactive') }}
                </UBadge>

                <div class="space-y-3 pr-16">
                  <h4 class="font-medium truncate">{{ template.name || t('bookings.emailTemplates.untitled') }}</h4>
                  <p class="text-sm text-muted line-clamp-1">{{ template.subject }}</p>

                  <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span class="flex items-center gap-1">
                      <UIcon name="i-lucide-user" class="size-3" />
                      {{ template.recipientType || 'customer' }}
                    </span>
                    <span v-if="template.daysOffset" class="flex items-center gap-1">
                      <UIcon name="i-lucide-calendar" class="size-3" />
                      {{ template.daysOffset > 0 ? '+' : '' }}{{ template.daysOffset }} {{ t('bookings.emailTemplates.days') }}
                    </span>
                    <span class="flex items-center gap-1">
                      <UIcon name="i-lucide-map-pin" class="size-3" />
                      {{ getLocationName(template.locationId) }}
                    </span>
                  </div>
                </div>

                <template #footer>
                  <div class="flex items-center justify-between">
                    <USwitch
                      :model-value="template.isActive"
                      size="sm"
                      @update:model-value="toggleActive(template)"
                    />
                    <div class="flex gap-1">
                      <UButton
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-pencil"
                        @click="openEditForm(template)"
                      />
                      <UButton
                        size="xs"
                        color="error"
                        variant="ghost"
                        icon="i-lucide-trash-2"
                        @click="deleteTemplate(template)"
                      />
                    </div>
                  </div>
                </template>
              </UCard>
            </div>

            <!-- Empty state -->
            <div v-else class="border border-dashed border-default rounded-lg p-6 text-center">
              <UIcon name="i-lucide-mail-x" class="size-8 text-muted mx-auto mb-2" />
              <p class="text-sm text-muted">{{ t('bookings.emailTemplates.noTemplates') }}</p>
              <UButton
                size="sm"
                color="neutral"
                variant="soft"
                class="mt-2"
                @click="openCreateForm(triggerType)"
              >
                {{ t('bookings.emailTemplates.createTemplate') }}
              </UButton>
            </div>
          </div>
        </div>
  </div>

  <!-- Edit/Create Modal -->
  <UModal v-model:open="showForm" :title="formAction === 'create' ? t('bookings.emailTemplates.newEmailTemplate') : t('bookings.emailTemplates.editTemplate')">
    <template #body>
      <UForm :state="formState" class="space-y-6" @submit="handleSubmit">
        <!-- Translation notice -->
        <div class="text-xs text-muted border-l-2 border-primary pl-3">
          {{ t('bookings.emailTemplates.translationNotice') }}
        </div>

        <!-- Language tabs -->
        <UTabs
          v-model="activeLocale"
          :items="locales.map(locale => ({
            value: locale.code,
            label: locale.label,
            slot: locale.code
          }))"
          :ui="{
            list: 'bg-muted/30 rounded-lg p-1',
            trigger: 'flex-1 text-sm font-medium rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground'
          }"
        >
          <template v-for="locale in locales" :key="locale.code" #[`${locale.code}-label`]>
            <span>
              {{ locale.label }}
              <span v-if="locale.required" class="text-error ml-0.5">*</span>
              <UIcon
                v-if="hasTranslation(locale.code)"
                name="i-lucide-check"
                class="size-3 ml-1 inline"
              />
            </span>
          </template>
        </UTabs>

        <!-- AI Generate button (only when crouton-ai is installed) -->
        <div v-if="hasAI" class="flex items-center justify-end">
          <UButton
            icon="i-lucide-sparkles"
            color="primary"
            variant="soft"
            size="xs"
            :loading="generating"
            :disabled="generating"
            @click="generateWithAI"
          >
            {{ t('bookings.emailTemplates.generateWithAI') }}
          </UButton>
        </div>

        <!-- Name (translatable) -->
        <UFormField :label="t('bookings.emailTemplates.templateName', { locale: activeLocale.toUpperCase() })" name="name" :required="activeLocale === 'en'">
          <UInput
            v-model="nameValue"
            :placeholder="$t('bookings.emailTemplates.namePlaceholder')"
            class="w-full"
          />
        </UFormField>

        <!-- Subject (translatable) -->
        <UFormField :label="t('bookings.emailTemplates.emailSubject', { locale: activeLocale.toUpperCase() })" name="subject" :required="activeLocale === 'en'">
          <UInput
            v-model="subjectValue"
            :placeholder="subjectPlaceholder"
            class="w-full"
          />
          <template #hint>
            <span class="text-xs text-muted" v-text="variableHint" />
          </template>
        </UFormField>

        <!-- Body with editor (translatable) -->
        <UFormField :label="t('bookings.emailTemplates.emailBody', { locale: activeLocale.toUpperCase() })" name="body" :required="activeLocale === 'en'">
          <CroutonEditorWithPreview
            v-model="bodyValue"
            :variables="variables"
            :preview-values="previewValues"
            :preview-title="$t('bookings.emailTemplates.previewTitle')"
            :placeholder="editorPlaceholder"
          />
        </UFormField>

        <USeparator />

        <!-- From email -->
        <UFormField :label="t('bookings.emailTemplates.fromEmail')" name="fromEmail" required>
          <UInput
            v-model="formState.fromEmail"
            type="email"
            :placeholder="$t('bookings.emailTemplates.fromEmailPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <!-- Trigger Type -->
        <UFormField :label="t('bookings.emailTemplates.triggerType')" name="triggerType">
          <USelect
            v-model="formState.triggerType"
            :items="[
              { label: t('bookings.emailTemplates.triggers.bookingCreated'), value: 'booking_created' },
              { label: t('bookings.emailTemplates.triggers.reminderBefore'), value: 'reminder_before' },
              { label: t('bookings.emailTemplates.triggers.bookingCancelled'), value: 'booking_cancelled' },
              { label: t('bookings.emailTemplates.triggers.followUpAfter'), value: 'follow_up_after' }
            ]"
            class="w-full"
          />
        </UFormField>

        <!-- Recipient -->
        <UFormField :label="t('bookings.emailTemplates.recipient')" name="recipientType">
          <USelect
            v-model="formState.recipientType"
            :items="[
              { label: t('bookings.emailTemplates.recipientCustomer'), value: 'customer' },
              { label: t('bookings.emailTemplates.recipientAdmin'), value: 'admin' },
              { label: t('bookings.emailTemplates.recipientBoth'), value: 'both' }
            ]"
            class="w-full"
          />
        </UFormField>

        <!-- Days Offset -->
        <UFormField :label="t('bookings.emailTemplates.daysOffset')" name="daysOffset">
          <UInputNumber v-model="formState.daysOffset" class="w-full" />
          <template #hint>
            <span class="text-xs text-muted">{{ t('bookings.emailTemplates.daysOffsetHint') }}</span>
          </template>
        </UFormField>

        <!-- Location -->
        <UFormField :label="t('bookings.emailTemplates.locationLabel')" name="locationId">
          <USelect
            v-model="formState.locationId"
            :items="locationOptions"
            class="w-full"
          />
          <template #hint>
            <span class="text-xs text-muted">{{ t('bookings.emailTemplates.locationHint') }}</span>
          </template>
        </UFormField>

        <!-- Active toggle -->
        <UFormField :label="t('bookings.emailTemplates.statusLabel')" name="isActive">
          <div class="flex items-center gap-2">
            <USwitch v-model="formState.isActive" />
            <span class="text-sm">{{ formState.isActive ? t('bookings.emailTemplates.active') : t('bookings.emailTemplates.inactive') }}</span>
          </div>
        </UFormField>

        <!-- Actions -->
        <div class="flex justify-end gap-2 pt-4 border-t border-default">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showForm = false"
          >
            {{ t('bookings.emailTemplates.cancel') }}
          </UButton>
          <UButton
            type="submit"
            color="primary"
            :loading="submitting"
          >
            {{ formAction === 'create' ? t('bookings.emailTemplates.createTemplate') : t('bookings.emailTemplates.saveChanges') }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
