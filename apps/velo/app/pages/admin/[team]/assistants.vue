<script setup lang="ts">
/**
 * Assistants IA — connect Claude / ChatGPT to velo (#4098).
 *
 * Shows the one link to paste (`<origin>/mcp`), short help, and the signed-in
 * person's OWN connected AI apps (better-auth's `oauth2/get-consents` only
 * returns the caller's consents). "Révoquer" deletes that one consent row, after
 * which /mcp refuses the connection's tokens (#4097). Open to every signed-in
 * member: Claude acts with each person's own rights.
 *
 * @route /admin/[team]/assistants
 */
import type { ClaudeConnection, Fetcher, OAuthConsentRow } from '~/utils/claudeConnections'
import { fetchClientNames, revokeClaudeConnection, toClaudeConnections } from '~/utils/claudeConnections'

definePageMeta({
  middleware: ['auth'],
  layout: 'admin'
})

const { t } = useT()
const { locale } = useI18n()
const toast = useToast()

const mcpUrl = computed(() => `${useRequestURL().origin}/mcp`)

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(mcpUrl.value)
    toast.add({ title: t('assistants.copied'), color: 'success' })
  }
  catch {
    // clipboard blocked (insecure context / permissions) — the field stays selectable
  }
}

const fetcher = $fetch as unknown as Fetcher
const rows = ref<ClaudeConnection[]>([])
const revoking = ref<string | null>(null)

const { data: consents, error, status } = useFetch<OAuthConsentRow[]>('/api/auth/oauth2/get-consents', { server: false })

watch(consents, async (list) => {
  const items = list ?? []
  const names = await fetchClientNames(items.map(c => c.clientId), fetcher)
  rows.value = toClaudeConnections(items, names)
}, { immediate: true })

const loading = computed(() => status.value === 'pending' || status.value === 'idle')

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(locale.value)
}

async function revoke(id: string) {
  revoking.value = id
  try {
    rows.value = await revokeClaudeConnection(rows.value, id, fetcher)
  }
  catch {
    toast.add({ title: t('assistants.revokeFailed'), color: 'error' })
  }
  finally {
    revoking.value = null
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="t('assistants.title')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-2xl w-full flex flex-col gap-6">
        <UFormField :label="t('assistants.urlLabel')">
          <UInput
            :model-value="mcpUrl"
            readonly
            class="w-full"
            data-testid="assistants-url"
            :ui="{ trailing: 'pe-1' }"
          >
            <template #trailing>
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="link"
                size="sm"
                :aria-label="t('assistants.copy')"
                data-testid="assistants-copy"
                @click="copyUrl"
              />
            </template>
          </UInput>
        </UFormField>

        <div class="flex flex-col gap-1">
          <p class="text-sm text-muted">
            {{ t('assistants.helpClaude') }}
          </p>
          <p class="text-sm text-muted">
            {{ t('assistants.helpChatgpt') }}
          </p>
        </div>

        <section class="flex flex-col gap-3">
          <h2 class="text-base font-semibold text-highlighted">
            {{ t('assistants.connections') }}
          </h2>

          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="t('assistants.loadFailed')"
          />
          <USkeleton v-else-if="loading" class="h-12 w-full" />
          <UAlert
            v-else-if="rows.length === 0"
            color="neutral"
            variant="subtle"
            icon="i-lucide-plug-zap"
            :title="t('assistants.empty')"
            data-testid="assistants-empty"
          />
          <ul v-else class="flex flex-col divide-y divide-default rounded-md border border-default">
            <li
              v-for="row in rows"
              :key="row.id"
              class="flex items-center justify-between gap-3 p-3"
              data-testid="assistants-row"
            >
              <div class="min-w-0">
                <p class="truncate font-medium text-highlighted">
                  {{ row.name }}
                </p>
                <p class="text-sm text-muted">
                  {{ t('assistants.connectedOn', { params: { date: formatDate(row.createdAt) } }) }}
                </p>
              </div>
              <UButton
                color="error"
                variant="soft"
                :label="t('assistants.revoke')"
                :loading="revoking === row.id"
                :disabled="revoking !== null && revoking !== row.id"
                @click="revoke(row.id)"
              />
            </li>
          </ul>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
