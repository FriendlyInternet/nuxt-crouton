<script setup lang="ts">
/**
 * Team Domain Settings Component
 *
 * Manages custom domains and public site toggle for a team.
 * Sections:
 * 1. Public site toggle (saves to site settings API)
 * 2. Domain list with status, verify, set-primary, delete actions
 * 3. Add domain form
 * 4. DNS instructions for pending domains
 */
const { teamSlug, teamId } = useTeamContext()
const { isAdmin } = useTeam()
const { t } = useT()
const notify = useNotify()

// ── Public Site Toggle ──────────────────────────────────────────────────
const publicSiteEnabled = ref(true)
const isLoadingSiteSettings = ref(true)
const isSavingSiteSettings = ref(false)

async function fetchSiteSettings() {
  try {
    const data = await $fetch<{ publicSiteEnabled?: boolean }>(`/api/teams/${teamId.value}/settings/site`)
    publicSiteEnabled.value = data.publicSiteEnabled !== false
  } catch {
    // Default to true if no settings exist
    publicSiteEnabled.value = true
  } finally {
    isLoadingSiteSettings.value = false
  }
}

async function togglePublicSite(value: boolean) {
  isSavingSiteSettings.value = true
  try {
    await $fetch(`/api/teams/${teamId.value}/settings/site`, {
      method: 'PATCH',
      body: { publicSiteEnabled: value }
    })
    publicSiteEnabled.value = value
    notify.success(t('teams.domains.siteSettingsSaved') || 'Site settings saved')
  } catch (e: unknown) {
    // Revert on failure
    publicSiteEnabled.value = !value
    const message = e instanceof Error ? e.message : t('teams.domains.siteSettingsFailed')
    notify.error(t('common.error') || 'Error', { description: message })
  } finally {
    isSavingSiteSettings.value = false
  }
}

// ── Domains ─────────────────────────────────────────────────────────────
interface Domain {
  id: string
  domain: string
  status: 'pending' | 'verified' | 'failed'
  verificationToken: string
  isPrimary: boolean
  verifiedAt: string | null
  createdAt: string
}

const domains = ref<Domain[]>([])
const isLoadingDomains = ref(true)
const newDomain = ref('')
const isAddingDomain = ref(false)
const verifyingDomainId = ref<string | null>(null)
const deletingDomainId = ref<string | null>(null)
const settingPrimaryId = ref<string | null>(null)
const expandedDomainId = ref<string | null>(null)

async function fetchDomains() {
  try {
    const data = await $fetch<Domain[]>(`/api/teams/${teamId.value}/domains`)
    domains.value = data
  } catch {
    domains.value = []
  } finally {
    isLoadingDomains.value = false
  }
}

async function addDomain() {
  if (!newDomain.value.trim()) return

  isAddingDomain.value = true
  try {
    const domain = await $fetch<Domain>(`/api/teams/${teamId.value}/domains`, {
      method: 'POST',
      body: { domain: newDomain.value.trim().toLowerCase() }
    })
    domains.value.push(domain)
    newDomain.value = ''
    expandedDomainId.value = domain.id
    notify.success(t('teams.domains.domainAdded') || 'Domain added', {
      description: t('teams.domains.addDnsRecord') || 'Add the DNS record to verify ownership.'
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('teams.domains.addFailed')
    notify.error(t('common.error') || 'Error', { description: message })
  } finally {
    isAddingDomain.value = false
  }
}

async function verifyDomain(domainId: string) {
  verifyingDomainId.value = domainId
  try {
    const result = await $fetch<{ verified: boolean; message: string }>(`/api/teams/${teamId.value}/domains/${domainId}/verify`, {
      method: 'POST'
    })

    if (result.verified) {
      const idx = domains.value.findIndex(d => d.id === domainId)
      if (idx !== -1) domains.value[idx]!.status = 'verified'
      notify.success(t('teams.domains.domainVerified') || 'Domain verified!')
    } else {
      const idx = domains.value.findIndex(d => d.id === domainId)
      if (idx !== -1) domains.value[idx]!.status = 'failed'
      notify.error(t('teams.domains.verificationFailed') || 'Verification failed', {
        description: result.message
      })
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('teams.domains.verificationFailed')
    notify.error(t('common.error') || 'Error', { description: message })
  } finally {
    verifyingDomainId.value = null
  }
}

async function setPrimary(domainId: string) {
  settingPrimaryId.value = domainId
  try {
    await $fetch(`/api/teams/${teamId.value}/domains/${domainId}/set-primary`, {
      method: 'POST'
    })
    // Update local state
    domains.value.forEach((d) => {
      d.isPrimary = d.id === domainId
    })
    notify.success(t('teams.domains.primarySet') || 'Primary domain updated')
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('teams.domains.setPrimaryFailed')
    notify.error(t('common.error') || 'Error', { description: message })
  } finally {
    settingPrimaryId.value = null
  }
}

async function deleteDomain(domainId: string) {
  deletingDomainId.value = domainId
  try {
    await $fetch(`/api/teams/${teamId.value}/domains/${domainId}`, {
      method: 'DELETE'
    })
    domains.value = domains.value.filter(d => d.id !== domainId)
    notify.success(t('teams.domains.domainDeleted') || 'Domain removed')
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('teams.domains.deleteFailed')
    notify.error(t('common.error') || 'Error', { description: message })
  } finally {
    deletingDomainId.value = null
  }
}

function statusColor(status: string) {
  switch (status) {
    case 'verified': return 'success'
    case 'pending': return 'warning'
    case 'failed': return 'error'
    default: return 'neutral'
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'verified': return t('teams.domains.statusVerified') || 'Verified'
    case 'pending': return t('teams.domains.statusPending') || 'Pending'
    case 'failed': return t('teams.domains.statusFailed') || 'Failed'
    default: return status
  }
}

// Fetch data on mount
fetchSiteSettings()
fetchDomains()
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <h3 class="text-lg font-semibold">
        {{ t('teams.domains.title') || 'Domains' }}
      </h3>
      <p class="text-sm text-muted mt-1">
        {{ t('teams.domains.description') || 'Manage custom domains and public site settings for your team.' }}
      </p>
    </div>

    <!-- Public Site Toggle -->
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-default">
          {{ t('teams.domains.publicSiteEnabled') || 'Public site enabled' }}
        </p>
        <p class="text-xs text-muted mt-0.5">
          {{ t('teams.domains.publicSiteDescription') || 'When disabled, your custom domain will not serve the public site.' }}
        </p>
      </div>
      <USwitch
        :model-value="publicSiteEnabled"
        :disabled="!isAdmin || isSavingSiteSettings || isLoadingSiteSettings"
        :loading="isSavingSiteSettings"
        @update:model-value="togglePublicSite"
      />
    </div>

    <USeparator />

    <!-- Loading State -->
    <div
      v-if="isLoadingDomains"
      class="flex items-center justify-center py-8"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="size-6 animate-spin text-muted"
      />
    </div>

    <template v-else>
      <!-- Domain List -->
      <div class="space-y-3">
        <div
          v-for="d in domains"
          :key="d.id"
          class="border border-default rounded-lg overflow-hidden"
        >
          <!-- Domain Row -->
          <div class="flex items-center gap-3 p-4">
            <UIcon
              name="i-lucide-globe"
              class="size-5 text-muted shrink-0"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-default truncate">{{ d.domain }}</span>
                <UBadge
                  v-if="d.isPrimary"
                  color="primary"
                  variant="subtle"
                  size="xs"
                >
                  {{ t('teams.domains.primary') || 'Primary' }}
                </UBadge>
                <UBadge
                  :color="statusColor(d.status)"
                  variant="subtle"
                  size="xs"
                >
                  {{ statusLabel(d.status) }}
                </UBadge>
              </div>
            </div>

            <div class="flex items-center gap-1 shrink-0">
              <!-- Verify button -->
              <UButton
                v-if="d.status !== 'verified'"
                variant="ghost"
                color="primary"
                size="xs"
                icon="i-lucide-shield-check"
                :loading="verifyingDomainId === d.id"
                :disabled="!isAdmin"
                @click="verifyDomain(d.id)"
              >
                {{ t('teams.domains.verify') || 'Verify' }}
              </UButton>

              <!-- Set primary button -->
              <UButton
                v-if="d.status === 'verified' && !d.isPrimary"
                variant="ghost"
                size="xs"
                icon="i-lucide-star"
                :loading="settingPrimaryId === d.id"
                :disabled="!isAdmin"
                @click="setPrimary(d.id)"
              >
                {{ t('teams.domains.setPrimary') || 'Set primary' }}
              </UButton>

              <!-- Toggle DNS instructions -->
              <UButton
                v-if="d.status !== 'verified'"
                variant="ghost"
                size="xs"
                :icon="expandedDomainId === d.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                @click="expandedDomainId = expandedDomainId === d.id ? null : d.id"
              />

              <!-- Delete button -->
              <UButton
                variant="ghost"
                color="error"
                size="xs"
                icon="i-lucide-trash-2"
                :loading="deletingDomainId === d.id"
                :disabled="!isAdmin"
                @click="deleteDomain(d.id)"
              />
            </div>
          </div>

          <!-- DNS Instructions (expandable) -->
          <div
            v-if="expandedDomainId === d.id && d.status !== 'verified'"
            class="border-t border-default bg-muted/30 p-4"
          >
            <p class="text-sm font-medium mb-2">
              {{ t('teams.domains.dnsInstructions') || 'Add this DNS record to verify domain ownership:' }}
            </p>
            <div class="bg-default rounded-md p-3 space-y-2 text-sm font-mono">
              <div class="flex gap-2">
                <span class="text-muted shrink-0">{{ t('teams.domains.recordType') || 'Type' }}:</span>
                <span class="text-default font-semibold">TXT</span>
              </div>
              <div class="flex gap-2">
                <span class="text-muted shrink-0">{{ t('teams.domains.recordName') || 'Name' }}:</span>
                <span class="text-default break-all">_crouton-verification.{{ d.domain }}</span>
              </div>
              <div class="flex gap-2">
                <span class="text-muted shrink-0">{{ t('teams.domains.recordValue') || 'Value' }}:</span>
                <span class="text-default break-all">{{ d.verificationToken }}</span>
              </div>
            </div>
            <p class="text-xs text-muted mt-2">
              {{ t('teams.domains.dnsPropagation') || 'DNS changes may take up to 48 hours to propagate. You can retry verification at any time.' }}
            </p>
          </div>
        </div>

        <!-- Empty state -->
        <div
          v-if="domains.length === 0"
          class="text-center py-8 border border-dashed border-default rounded-lg"
        >
          <UIcon
            name="i-lucide-globe"
            class="size-10 mx-auto mb-3 text-muted opacity-50"
          />
          <p class="text-sm text-muted">
            {{ t('teams.domains.noDomains') || 'No custom domains configured yet.' }}
          </p>
        </div>
      </div>

      <USeparator />

      <!-- Add Domain Form -->
      <div class="space-y-2">
        <label class="text-sm font-medium text-default">
          {{ t('teams.domains.addDomain') || 'Add domain' }}
        </label>
        <div class="flex gap-2">
          <UInput
            v-model="newDomain"
            :placeholder="t('teams.domains.domainPlaceholder') || 'e.g. booking.example.com'"
            class="flex-1"
            :disabled="!isAdmin || isAddingDomain"
            @keyup.enter="addDomain"
          />
          <UButton
            color="primary"
            :loading="isAddingDomain"
            :disabled="!isAdmin || !newDomain.trim()"
            @click="addDomain"
          >
            {{ t('teams.domains.add') || 'Add' }}
          </UButton>
        </div>
      </div>

      <!-- Admin Warning -->
      <UAlert
        v-if="!isAdmin"
        color="warning"
        icon="i-lucide-shield-alert"
        :title="t('teams.adminAccessRequired') || 'Admin access required'"
        :description="t('teams.domains.adminOnly') || 'Only team admins and owners can manage domains.'"
      />
    </template>
  </div>
</template>
