<script setup lang="ts">
/**
 * Team Site Info Settings Component
 *
 * Manages team site settings: contact email, newsletter URL,
 * calendar URL, registration URL, and social media links.
 */
const { teamId } = useTeamContext()
const { isAdmin } = useTeam()
const { t } = useT()
const notify = useNotify()

const siteSettings = useState<Record<string, any> | null>('team-site-settings', () => null)
const isSaving = ref(false)
const isLoading = ref(true)

const form = reactive({
  contactEmail: '',
  newsletterUrl: '',
  calendarUrl: '',
  registrationUrl: '',
  socialLinks: {
    facebook: '',
    instagram: '',
    youtube: '',
    linkedin: '',
    twitter: '',
    tiktok: ''
  }
})

// Load current settings
async function loadSettings() {
  if (!teamId.value) return
  isLoading.value = true
  try {
    const data = await $fetch<Record<string, any>>(`/api/teams/${teamId.value}/settings/site`)
    if (data) {
      form.contactEmail = data.contactEmail || ''
      form.newsletterUrl = data.newsletterUrl || ''
      form.calendarUrl = data.calendarUrl || ''
      form.registrationUrl = data.registrationUrl || ''
      if (data.socialLinks) {
        form.socialLinks = { ...form.socialLinks, ...data.socialLinks }
      }
      siteSettings.value = { ...siteSettings.value, ...data }
    }
  } catch {
    // Settings may not exist yet
  } finally {
    isLoading.value = false
  }
}

async function save() {
  if (!teamId.value) return
  isSaving.value = true
  try {
    // Clean empty strings from socialLinks
    const socialLinks: Record<string, string> = {}
    for (const [key, val] of Object.entries(form.socialLinks)) {
      if (val) socialLinks[key] = val
    }

    const updated = await $fetch<Record<string, any>>(`/api/teams/${teamId.value}/settings/site`, {
      method: 'PATCH',
      body: {
        contactEmail: form.contactEmail || '',
        newsletterUrl: form.newsletterUrl || '',
        calendarUrl: form.calendarUrl || '',
        registrationUrl: form.registrationUrl || '',
        socialLinks: Object.keys(socialLinks).length > 0 ? socialLinks : undefined
      }
    })
    siteSettings.value = { ...siteSettings.value, ...updated }
    notify.success(t('common.saved') || 'Saved')
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Failed to save'
    notify.error(t('common.error') || 'Error', { description: message })
  } finally {
    isSaving.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <div class="space-y-4">
    <div>
      <h3 class="text-lg font-semibold">
        {{ t('teams.siteInfo.title') || 'Site Information' }}
      </h3>
      <p class="text-sm text-muted mt-1">
        {{ t('teams.siteInfo.description') || 'Contact details, links, and social media for your public site.' }}
      </p>
    </div>

    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
    </div>

    <div v-else class="space-y-6">
      <!-- Contact & Links -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <UFormField :label="t('teams.siteInfo.contactEmail') || 'Contact Email'">
          <UInput
            v-model="form.contactEmail"
            type="email"
            placeholder="info@example.com"
            :disabled="!isAdmin"
            icon="i-lucide-mail"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="t('teams.siteInfo.newsletterUrl') || 'Newsletter URL'">
          <UInput
            v-model="form.newsletterUrl"
            type="url"
            placeholder="https://..."
            :disabled="!isAdmin"
            icon="i-lucide-newspaper"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="t('teams.siteInfo.calendarUrl') || 'Calendar URL'">
          <UInput
            v-model="form.calendarUrl"
            type="url"
            placeholder="https://..."
            :disabled="!isAdmin"
            icon="i-lucide-calendar"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="t('teams.siteInfo.registrationUrl') || 'Registration URL'">
          <UInput
            v-model="form.registrationUrl"
            type="url"
            placeholder="https://..."
            :disabled="!isAdmin"
            icon="i-lucide-user-plus"
            class="w-full"
          />
        </UFormField>
      </div>

      <!-- Social Links -->
      <div>
        <h4 class="text-sm font-medium mb-3">{{ t('teams.siteInfo.socialLinks') || 'Social Media' }}</h4>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UFormField label="Facebook">
            <UInput
              v-model="form.socialLinks.facebook"
              placeholder="https://facebook.com/..."
              :disabled="!isAdmin"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Instagram">
            <UInput
              v-model="form.socialLinks.instagram"
              placeholder="https://instagram.com/..."
              :disabled="!isAdmin"
              class="w-full"
            />
          </UFormField>
          <UFormField label="YouTube">
            <UInput
              v-model="form.socialLinks.youtube"
              placeholder="https://youtube.com/..."
              :disabled="!isAdmin"
              class="w-full"
            />
          </UFormField>
          <UFormField label="LinkedIn">
            <UInput
              v-model="form.socialLinks.linkedin"
              placeholder="https://linkedin.com/..."
              :disabled="!isAdmin"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Twitter / X">
            <UInput
              v-model="form.socialLinks.twitter"
              placeholder="https://x.com/..."
              :disabled="!isAdmin"
              class="w-full"
            />
          </UFormField>
          <UFormField label="TikTok">
            <UInput
              v-model="form.socialLinks.tiktok"
              placeholder="https://tiktok.com/..."
              :disabled="!isAdmin"
              class="w-full"
            />
          </UFormField>
        </div>
      </div>

      <!-- Save button -->
      <div class="flex justify-end">
        <UButton
          :label="t('common.save') || 'Save'"
          :loading="isSaving"
          :disabled="!isAdmin"
          @click="save"
        />
      </div>
    </div>
  </div>
</template>
