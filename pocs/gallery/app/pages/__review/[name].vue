<script setup lang="ts">
// One piece on its own page (#2462): /__review/<ComponentName>. Loads only that component's chunk.
//
// What the piece is shown with, later wins:
//   1. a page block's registered default content (core blocks + addon `croutonBlocks`)
//   2. its line in app/review-samples.ts
//   3. `?props={...}` on the link
// A piece still missing a required input is NOT rendered (that's the blank page): the page names
// what it needs. A piece that throws while rendering is caught and shown as a message, so the
// review link never turns into a crashed page (the #2423 CF 1102 shape).
import type { Component } from 'vue'
import { pieces } from '#build/gallery-pieces.mjs'
import { reviewSamples } from '~/review-samples'

definePageMeta({ layout: false })

const allowed = import.meta.dev || !!(useRuntimeConfig().public as Record<string, unknown>).croutonReview
if (!allowed) throw createError({ status: 404, statusText: 'Not found', fatal: true })

const route = useRoute()
const name = computed(() => String(route.params.name))
const piece = computed(() => pieces.find(p => p.name === name.value))
useHead({ title: () => `${name.value} · Gallery` })

// --- 1. block defaults -------------------------------------------------------------------------
interface AddonBlock { defaultAttrs?: Record<string, unknown>, components?: { renderer?: string } }
const appConfig = useAppConfig() as { croutonBlocks?: Record<string, AddonBlock> }
const CORE_BLOCK_PREFIX = 'CroutonPagesBlocksRender'

function blockDefaults(component: string): Record<string, unknown> | null {
  for (const def of Object.values(appConfig.croutonBlocks ?? {})) {
    if (def?.components?.renderer === component) return { ...(def.defaultAttrs ?? {}) }
  }
  if (!component.startsWith(CORE_BLOCK_PREFIX)) return null
  const wanted = component.slice(CORE_BLOCK_PREFIX.length).toLowerCase()
  const type = Object.keys(blockRegistry).find(t => t.toLowerCase() === wanted)
  return type ? { ...getBlockDefaultAttrs(type as keyof typeof blockRegistry) } : null
}

// --- 2 + 3. samples and the link ---------------------------------------------------------------
const queryProps = computed<Record<string, unknown>>(() => {
  const raw = route.query.props
  if (typeof raw !== 'string' || !raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
})

const props = computed<Record<string, unknown>>(() => {
  const attrs = blockDefaults(name.value)
  return {
    ...(attrs ? { attrs } : {}),
    ...(reviewSamples[name.value] ?? {}),
    ...queryProps.value,
  }
})

// --- loading + "needs" ------------------------------------------------------------------------
const view = shallowRef<Component | null>(null)
const failure = ref<string | null>(null)
const loading = ref(false)

/** Required props the component declares but nothing above supplies. */
function requiredProps(comp: Component): string[] {
  const declared = (comp as { props?: unknown }).props
  if (!declared || Array.isArray(declared)) return []
  return Object.entries(declared as Record<string, unknown>)
    .filter(([, opt]) => !!opt && typeof opt === 'object' && (opt as { required?: boolean }).required)
    .map(([key]) => key)
}
const missing = computed(() => {
  if (!view.value) return []
  const given = new Set(Object.keys(props.value))
  return requiredProps(view.value).filter(k => !given.has(k) && !given.has(k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)))
})

async function load() {
  view.value = null
  failure.value = null
  if (!piece.value || import.meta.server) return
  loading.value = true
  try {
    const mod = await piece.value.load()
    view.value = markRaw(mod.default)
  } catch (e) {
    failure.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(name, load)

onErrorCaptured((e) => {
  failure.value = e instanceof Error ? e.message : String(e)
  return false
})

// --- 4. state buttons (who's looking, what just happened) --------------------------------------
type Identity = 'member' | 'visitor' | 'signedOut'
const authUser = useState<Record<string, unknown> | null>('crouton-auth-user', () => null)
const scopedSession = useState<{ displayName: string } | null>('crouton:scoped-session', () => null)
const identity = ref<Identity | null>(null)

function setIdentity(next: Identity) {
  identity.value = next
  const now = new Date().toISOString()
  authUser.value = next === 'member'
    ? { id: 'review', email: 'maarten@example.com', name: 'Maarten Pol', image: null, emailVerified: true, createdAt: now, updatedAt: now }
    : null
  scopedSession.value = next === 'visitor' ? { displayName: 'Lotte' } : null
}
const identities: { key: Identity, label: string }[] = [
  { key: 'member', label: 'Signed in' },
  { key: 'visitor', label: 'PIN visitor' },
  { key: 'signedOut', label: 'Signed out' },
]

const { push } = useCroutonStatus()
const statuses = [
  { label: 'Success', color: 'success' as const, run: () => push({ type: 'success', text: 'You saved “Kayak Rental”' }) },
  { label: 'Info', color: 'info' as const, run: () => push({ type: 'info', text: 'Invitation sent', icon: 'i-lucide-info' }) },
  { label: 'Warning', color: 'warning' as const, run: () => push({ type: 'warning', text: 'Check the highlighted fields', icon: 'i-lucide-triangle-alert' }) },
  {
    label: 'Error',
    color: 'error' as const,
    run: () => push({
      type: 'error',
      text: 'Couldn’t save “Center Court”',
      icon: 'i-lucide-circle-alert',
      retry: () => push({ type: 'success', text: 'You saved “Center Court”' }),
    }),
  },
]
const showStates = ref(false)
</script>

<template>
  <div class="min-h-screen bg-default">
    <header class="flex items-center gap-2 border-b border-default px-2 py-2">
      <UButton
        to="/__review"
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="ghost"
        aria-label="All pieces"
      />
      <div class="min-w-0 flex-1">
        <p class="truncate font-mono text-sm font-medium">
          {{ name }}
        </p>
        <p
          v-if="piece"
          class="text-xs text-muted"
        >
          {{ piece.pkg.replace(/^crouton-/, '') }}
        </p>
      </div>
      <UButton
        icon="i-lucide-sliders-horizontal"
        :color="showStates ? 'primary' : 'neutral'"
        variant="ghost"
        aria-label="States"
        @click="showStates = !showStates"
      />
    </header>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="-translate-y-1 opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="-translate-y-1 opacity-0"
    >
      <section
        v-if="showStates"
        class="space-y-3 border-b border-default bg-elevated/50 px-4 py-3"
      >
        <div class="space-y-1.5">
          <p class="text-xs font-medium text-muted">
            Who's looking
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="i in identities"
              :key="i.key"
              :label="i.label"
              size="sm"
              color="neutral"
              :variant="identity === i.key ? 'solid' : 'outline'"
              @click="setIdentity(i.key)"
            />
          </div>
        </div>
        <div class="space-y-1.5">
          <p class="text-xs font-medium text-muted">
            Something just happened
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="s in statuses"
              :key="s.label"
              :label="s.label"
              :color="s.color"
              size="sm"
              variant="soft"
              @click="s.run()"
            />
          </div>
        </div>
      </section>
    </Transition>

    <main class="p-4">
      <UAlert
        v-if="!piece"
        color="warning"
        variant="subtle"
        icon="i-lucide-search-x"
        title="No piece with this name"
        description="Check the spelling, or pick it from the list."
      />
      <UAlert
        v-else-if="failure"
        color="neutral"
        variant="subtle"
        icon="i-lucide-puzzle"
        title="This piece needs more to show"
        :description="failure"
      />
      <UAlert
        v-else-if="missing.length"
        color="neutral"
        variant="subtle"
        icon="i-lucide-puzzle"
        title="This piece needs input to show"
        :description="`Needs: ${missing.join(', ')}. Add a line for it in review-samples.ts.`"
      />
      <component
        :is="view"
        v-else-if="view"
        v-bind="props"
      />
      <p
        v-else-if="loading"
        class="text-sm text-muted"
      >
        Loading…
      </p>
    </main>
  </div>
</template>
