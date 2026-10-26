<script setup lang="ts">
// One piece on its own page (#2462): /__review/<ComponentName>. Loads only that component's chunk.
// A piece that needs props/data it doesn't get throws while rendering; that is caught and shown as
// a plain message so the review link never turns into a crashed page (the #2423 CF 1102 shape).
import { pieces } from '#build/gallery-pieces.mjs'

definePageMeta({ layout: false })

const allowed = import.meta.dev || !!(useRuntimeConfig().public as Record<string, unknown>).croutonReview
if (!allowed) throw createError({ status: 404, statusText: 'Not found', fatal: true })

const route = useRoute()
const name = computed(() => String(route.params.name))
const piece = computed(() => pieces.find(p => p.name === name.value))
useHead({ title: () => `${name.value} · Gallery` })

// `?props={"placement":"inline"}` passes props straight through — for pieces that need some.
const props = computed<Record<string, unknown>>(() => {
  const raw = route.query.props
  if (typeof raw !== 'string' || !raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
})

const failure = ref<string | null>(null)
const view = computed(() => piece.value
  ? defineAsyncComponent({ loader: piece.value.load, onError: (e, _retry, fail) => { failure.value = e.message; fail() } })
  : null)
watch(name, () => { failure.value = null })

onErrorCaptured((e) => {
  failure.value = e instanceof Error ? e.message : String(e)
  return false
})
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
      <div class="min-w-0">
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
    </header>

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
      <ClientOnly v-else>
        <component
          :is="view"
          v-bind="props"
        />
        <template #fallback>
          <p class="text-sm text-muted">
            Loading…
          </p>
        </template>
      </ClientOnly>
    </main>
  </div>
</template>
