<script setup lang="ts">
/**
 * Self-contained POS panel
 *
 * One component owning the whole POS auth + data flow, reusable in the admin
 * order page, the workspace kassa aside, and (potentially) the CMS block:
 *
 *   team-member session  →  admin token issued automatically (no PIN form)
 *   helper (anonymous)   →  inline PIN + name login form
 *   authenticated        →  <SalesClientOrderInterface> (editable for admins)
 *
 * Helper sessions live in localStorage/cookie, so everything loads client-side
 * (onMounted); SSR renders the loading state. Pre-fetched order-data is
 * re-fetched whenever a crouton mutation touches the sales catalog, so
 * products/categories created from the editable POS show up immediately.
 */
import type { SalesProduct, SalesCategory } from '../../types'

const props = withDefaults(defineProps<{
  /** Slug of the event to open the POS for. */
  eventSlug: string
  /** Team route param (slug or id). Defaults to `route.params.team`. */
  teamParam?: string
  /** Allow admin editing affordances (only applies to team-member sessions). */
  editable?: boolean
  /** Pass-through to OrderInterface: hide the inline edit pencil (host renders its own). */
  hideEditToggle?: boolean
  /** Show the event title / logged-in-as header row. */
  showHeader?: boolean
  /** Render a close button on the header's right — set when the panel runs
   *  inside the fullscreen kassa modal so the volunteer can exit. */
  closable?: boolean
}>(), {
  editable: true,
  showHeader: true
})

const emit = defineEmits<{ close: [] }>()

// Pass-through model so a host (workspace Shell) can drive the kassa's edit
// mode from outside; unbound it stays OrderInterface-local.
const editMode = defineModel<boolean>('editMode', { default: false })

const { t } = useT()
const route = useRoute()
const { loggedIn } = useAuth()

const teamParam = computed(() => props.teamParam || String(route.params.team || ''))

// Staff door on the volunteer login: member sign-in that returns to this page
// (where the workspace shell renders for logged-in team members). dismissible=1
// lets the volunteer close the member modal and fall back to the PIN form.
const staffLoginUrl = computed(() => `/auth/login?redirect=${encodeURIComponent(route.fullPath)}&dismissible=1`)

interface PublicEvent {
  id: string
  teamId: string
  title: string
  slug: string
  status?: string
}

interface OrderData {
  event: { id: string, title: string, slug: string, teamId: string, requiresClient: boolean, currency?: string }
  products: SalesProduct[]
  categories: SalesCategory[]
  clients: { id: string, title: string }[]
  locations: { id: string, title: string }[]
  helper: { id: string, name: string }
}

const {
  isHelper,
  loadSession,
  token,
  eventId: sessionEventId,
  teamId: sessionTeamId,
  login,
  loginAsAdmin,
  adoptScopedSession
} = useHelperAuth()

const publicEvent = ref<PublicEvent | null>(null)
const lookupError = ref<string | null>(null)
const orderData = ref<OrderData | null>(null)
const loadError = ref<string | null>(null)
const initialLoading = ref(true)

// Editing is only offered to real team sessions — the crouton create forms
// post to team-scoped endpoints a helper token can't reach.
const editable = computed(() => props.editable && loggedIn.value)

const sessionMatchesEvent = computed(() =>
  !!publicEvent.value
  && isHelper.value
  && sessionTeamId.value === publicEvent.value.teamId
  && sessionEventId.value === publicEvent.value.id
)

// Login form state (helper PIN fallback)
const formState = reactive({ helperName: '', pin: '' })
const loginError = ref('')
const submitting = ref(false)

async function loadEvent() {
  try {
    publicEvent.value = await $fetch<PublicEvent>(
      `/api/crouton-sales/events/${teamParam.value}/by-slug/${props.eventSlug}`
    )
  }
  catch (err: any) {
    lookupError.value = err?.data?.message || err?.statusMessage || t('sales.helperLogin.eventNotFound')
  }
}

async function loadOrderData() {
  if (!publicEvent.value || !sessionMatchesEvent.value) return
  loadError.value = null
  try {
    orderData.value = await $fetch<OrderData>(
      `/api/crouton-sales/events/${publicEvent.value.id}/order-data`,
      { headers: { 'x-scoped-token': token.value } }
    )
  }
  catch (err: any) {
    loadError.value = err?.data?.message || err?.statusMessage || t('sales.helperLogin.loadDataError')
  }
}

async function onLoginSubmit() {
  if (!publicEvent.value) return
  if (!formState.helperName.trim()) {
    loginError.value = t('sales.helperLogin.enterNameError')
    return
  }
  if (!formState.pin.trim()) {
    loginError.value = t('sales.helperLogin.enterPinError')
    return
  }
  loginError.value = ''
  submitting.value = true
  const success = await login({
    teamId: publicEvent.value.teamId,
    eventId: publicEvent.value.id,
    pin: formState.pin,
    helperName: formState.helperName.trim()
  })
  submitting.value = false
  if (success) {
    await loadOrderData()
  }
  else {
    loginError.value = t('sales.helperLogin.failed')
  }
}

onMounted(async () => {
  loadSession()
  await loadEvent()
  if (publicEvent.value) {
    // No (matching) helper session yet — try, in order:
    // 1) adopt the page gate's event session (a scoped page already redeemed
    //    the event's helper PIN — the volunteer never sees a second PIN form)
    // 2) team members mint an admin helper token (no PIN)
    // 3) fall through to the inline PIN form
    if (!sessionMatchesEvent.value) {
      adoptScopedSession({ teamId: publicEvent.value.teamId, eventId: publicEvent.value.id })
    }
    if (!sessionMatchesEvent.value && loggedIn.value) {
      await loginAsAdmin({ teamId: publicEvent.value.teamId, eventId: publicEvent.value.id })
    }
    await loadOrderData()
  }
  initialLoading.value = false
})

// Products/categories/locations created or edited from the POS (or anywhere
// else while it's open) must show up without a reload — order-data is a
// plain pre-fetched payload, so re-fetch it on relevant mutations.
// salesEvents is included so flipping event flags in the settings panel
// (e.g. "Require client") reaches the kassa live. salesClients so a tab
// settled in the clients panel (end-receipt deactivates the client) drops
// out of the client picker immediately.
const CATALOG_COLLECTIONS = ['salesProducts', 'salesCategories', 'salesLocations', 'salesEvents', 'salesClients']
const unhookMutation = useNuxtApp().hook('crouton:mutation', (payload: any) => {
  if (orderData.value && CATALOG_COLLECTIONS.includes(payload.collection)) {
    loadOrderData()
  }
})
onUnmounted(unhookMutation)
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Event lookup failed -->
    <UAlert
      v-if="lookupError"
      color="error"
      variant="subtle"
      icon="i-lucide-alert-circle"
      :title="lookupError"
    />

    <!-- Initial lookup / auto-login pending -->
    <div
      v-else-if="initialLoading"
      class="flex-1 flex items-center justify-center p-12"
    >
      <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-muted" />
    </div>

    <!-- Authenticated + data loaded → full POS -->
    <template v-else-if="orderData">
      <!-- One slim line: logout at the LEFT (the page's floating color-mode
           pill owns the top-right corner), then title + helper name. No
           store icon — every saved pixel goes to the product list on phones. -->
      <!-- Pure ordering surface: title + which helper is signed in, and a
           close button when launched in the fullscreen modal. Session
           controls (logout) live in the launcher / page chrome, never here. -->
      <header
        v-if="showHeader"
        class="flex items-center gap-2 px-3 py-2 border-b border-default shrink-0"
      >
        <h2 class="flex-1 min-w-0 font-semibold leading-tight truncate">
          {{ orderData.event.title }}
          <span class="text-sm text-muted font-normal">· {{ orderData.helper.name }}</span>
        </h2>
        <!-- Exit the fullscreen kassa modal. -->
        <UButton
          v-if="closable"
          icon="i-lucide-x"
          variant="ghost"
          color="neutral"
          size="sm"
          :aria-label="t('sales.common.close')"
          @click.stop="emit('close')"
        />
      </header>
      <div class="flex-1 min-h-0">
        <SalesClientOrderInterface
          :event-id="orderData.event.id"
          :products="orderData.products"
          :categories="orderData.categories"
          :clients="orderData.clients"
          :locations="orderData.locations"
          :requires-client="orderData.event.requiresClient"
          :currency="orderData.event.currency"
          :editable="editable"
          :hide-edit-toggle="hideEditToggle"
          :closable="closable && !showHeader"
          v-model:edit-mode="editMode"
          @close="emit('close')"
        />
      </div>
    </template>

    <!-- order-data fetch failed (auth ok, but server errored) -->
    <UAlert
      v-else-if="loadError && isHelper"
      color="error"
      variant="subtle"
      icon="i-lucide-alert-circle"
      :title="loadError"
      :actions="[{ label: t('sales.common.retry'), color: 'error', variant: 'soft', onClick: loadOrderData }]"
    />

    <!-- Not logged in: inline helper login form (PIN fallback) -->
    <div
      v-else-if="publicEvent"
      class="p-6"
    >
      <div class="max-w-sm mx-auto space-y-5">
        <div class="text-center">
          <UIcon name="i-lucide-store" class="text-3xl text-primary mb-2" />
          <h2 class="text-lg font-semibold">{{ publicEvent.title }}</h2>
          <p class="text-sm text-muted mt-1">{{ t('sales.helperLogin.required') }}</p>
        </div>
        <UForm :state="formState" class="space-y-3" @submit="onLoginSubmit">
          <UFormField :label="t('sales.helperLogin.yourName')" name="helperName">
            <UInput
              v-model="formState.helperName"
              :placeholder="t('sales.helperLogin.enterName')"
              size="lg"
              class="w-full"
              autocomplete="name"
            />
          </UFormField>
          <UFormField :label="t('sales.helperLogin.pin')" name="pin">
            <UInput
              v-model="formState.pin"
              type="password"
              :placeholder="t('sales.helperLogin.enterPin')"
              size="lg"
              class="w-full"
              :ui="{ base: 'font-mono text-center tracking-widest' }"
              inputmode="numeric"
              pattern="[0-9]*"
            />
          </UFormField>
          <UButton
            type="submit"
            :loading="submitting"
            block
            size="lg"
            icon="i-lucide-log-in"
          >
            {{ t('sales.helperLogin.login') }}
          </UButton>
        </UForm>
        <UAlert
          v-if="loginError"
          color="error"
          variant="soft"
          icon="i-lucide-alert-circle"
          :title="loginError"
        />
        <!-- Staff door: a team member signs in with their account and returns
             here as admin (the workspace shell renders for logged-in members).
             Separate backend from the volunteer PIN — same screen, two doors. -->
        <div class="text-center pt-1">
          <UButton
            :to="staffLoginUrl"
            variant="link"
            color="neutral"
            size="sm"
            :label="t('sales.helperLogin.staffLogin')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
