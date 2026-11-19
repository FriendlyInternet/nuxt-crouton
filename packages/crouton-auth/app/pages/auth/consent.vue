<script setup lang="ts">
/**
 * OAuth consent page for MCP apps (Claude, ChatGPT, …) — #4096
 *
 * The sign-in provider (`mcp()`, on when `croutonAuth.mcpOAuth` is set) sends
 * the signed-in user here as /auth/consent?client_id=…&scope=…&redirect_uri=…&sig=…
 * We show who is asking (the client's own name + the host of its redirect
 * URI, already matched against the client record and covered by `sig`) and
 * the scopes in plain words. No team picker and no team switch: the token
 * names the user only; /mcp checks the team on every call.
 */
definePageMeta({
  layout: 'auth',
  middleware: 'auth'
})

const { t } = useT()
const route = useRoute()

const clientId = computed(() => (route.query.client_id as string | undefined) || '')
const scopes = computed(() => ((route.query.scope as string | undefined) || '').split(' ').filter(Boolean))

// The host of the registered redirect URI — a self-declared name can be faked,
// the redirect host can't (it is where the code goes). Hidden if unparseable.
// Complexity: input guards around one URL parse; page code with no unit coverage inflates CRAP (covered by e2e/mcp-oauth.smoke.spec.ts T9)
// fallow-ignore-next-line complexity
const redirectHost = computed(() => {
  const raw = route.query.redirect_uri
  if (typeof raw !== 'string' || !raw) return null
  try {
    return new URL(raw).host || null
  } catch {
    return null
  }
})

const { data: client } = await useFetch<{ client_name?: string }>('/api/auth/oauth2/public-client', {
  query: { client_id: clientId },
  immediate: !!clientId.value,
  server: false
})

const clientName = computed(() => client.value?.client_name || t('auth.consent.unnamedClient'))
const knownScopes = ['pages', 'offline_access']
const scopeLines = computed(() => scopes.value
  .filter(scope => knownScopes.includes(scope))
  .map(scope => t(`auth.consent.scopes.${scope}`)))

const submitting = ref(false)
const failed = ref(false)

/** The signed query, as the server expects it back (only `sig` + signed params). */
function signedQuery(): string | undefined {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('sig')) return undefined
  return params.toString()
}

// Complexity: one request plus its three outcomes; page code with no unit coverage inflates CRAP (covered by e2e/mcp-oauth.smoke.spec.ts T4/T5)
// fallow-ignore-next-line complexity
async function answer(accept: boolean) {
  const oauthQuery = signedQuery()
  if (!oauthQuery) {
    failed.value = true
    return
  }
  submitting.value = true
  failed.value = false
  try {
    const result = await $fetch<{ redirect?: boolean, url?: string }>('/api/auth/oauth2/consent', {
      method: 'POST',
      body: { accept, oauth_query: oauthQuery }
    })
    if (result?.url) {
      // One full page load to the client's callback (code or access_denied).
      // Buttons stay disabled while the browser leaves.
      window.location.assign(result.url)
      return
    }
    failed.value = true
    submitting.value = false
  } catch {
    failed.value = true
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <!-- Missing request / form / error states are display variations, not independent logic (covered by e2e/mcp-oauth.smoke.spec.ts) -->
    <!-- fallow-ignore-next-line complexity -->
    <UAlert v-if="!route.query.sig || !clientId"
            color="error"
            icon="i-lucide-alert-triangle"
            :title="$t('auth.consent.missingRequest')"
    />

    <template v-else>
      <div class="text-center">
        <h1
          class="text-2xl font-bold text-highlighted"
          data-testid="consent-title"
        >
          {{ $t('auth.consent.title', { client: clientName }) }}
        </h1>
        <p
          v-if="redirectHost"
          class="mt-2 text-sm text-muted"
          data-testid="consent-host"
        >
          {{ $t('auth.consent.via', { host: redirectHost }) }}
        </p>
      </div>

      <div
        v-if="scopeLines.length"
        class="mt-6"
      >
        <p class="text-sm text-default">
          {{ $t('auth.consent.intro') }}
        </p>
        <ul class="mt-2 space-y-2">
          <li
            v-for="line in scopeLines"
            :key="line"
            class="flex items-start gap-2 text-sm text-default"
          >
            <UIcon
              name="i-lucide-check"
              class="mt-0.5 size-4 shrink-0 text-primary"
            />
            <span>{{ line }}</span>
          </li>
        </ul>
      </div>

      <UAlert
        v-if="failed"
        class="mt-6"
        color="error"
        icon="i-lucide-alert-triangle"
        :title="$t('auth.consent.failed')"
      />

      <div class="mt-8 flex gap-3">
        <UButton
          block
          color="neutral"
          variant="outline"
          :disabled="submitting"
          data-testid="consent-deny"
          @click="answer(false)"
        >
          {{ $t('auth.consent.deny') }}
        </UButton>
        <UButton
          block
          :loading="submitting"
          :disabled="submitting"
          data-testid="consent-allow"
          @click="answer(true)"
        >
          {{ $t('auth.consent.allow') }}
        </UButton>
      </div>
    </template>
  </div>
</template>
