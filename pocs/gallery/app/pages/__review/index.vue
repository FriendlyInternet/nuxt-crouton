<script setup lang="ts">
// The gallery's index (#2462): every shared UI piece, grouped by package, each opening its own
// review page. Like themes.pmcp.dev, for every part. Review-only — 404 outside dev/review builds.
import { pieces } from '#build/gallery-pieces.mjs'

definePageMeta({ layout: false })

const allowed = import.meta.dev || !!(useRuntimeConfig().public as Record<string, unknown>).croutonReview
if (!allowed) throw createError({ status: 404, statusText: 'Not found', fatal: true })

useHead({ title: 'Gallery' })

// `/__review?file=packages/<pkg>/app/components/X.vue` → that piece's page. A PR knows which
// files it changed, not their component names, so its gallery links use this (#2462).
const route = useRoute()
const fromFile = typeof route.query.file === 'string' ? pieces.find(p => p.src === route.query.file) : undefined
if (fromFile) await navigateTo(`/__review/${fromFile.name}`, { replace: true })

const query = ref('')

const groups = computed(() => {
  const q = query.value.trim().toLowerCase()
  const byPkg = new Map<string, string[]>()
  for (const p of pieces) {
    if (q && !p.name.toLowerCase().includes(q) && !p.pkg.includes(q)) continue
    const list = byPkg.get(p.pkg) ?? []
    list.push(p.name)
    byPkg.set(p.pkg, list)
  }
  return [...byPkg.entries()].map(([pkg, names]) => ({ pkg, label: pkg.replace(/^crouton-/, ''), names }))
})

const shown = computed(() => groups.value.reduce((n, g) => n + g.names.length, 0))
</script>

<template>
  <div class="min-h-screen bg-default">
    <header class="sticky top-0 z-10 space-y-3 border-b border-default bg-default/90 px-4 py-4 backdrop-blur">
      <div class="flex items-baseline justify-between gap-3">
        <h1 class="text-lg font-semibold">
          Gallery
        </h1>
        <span class="text-sm text-muted">{{ shown }} of {{ pieces.length }} pieces</span>
      </div>
      <UInput
        v-model="query"
        icon="i-lucide-search"
        placeholder="Find a piece or a part…"
        class="w-full"
        size="lg"
      />
    </header>

    <main class="mx-auto max-w-2xl space-y-6 p-4">
      <section
        v-for="g in groups"
        :key="g.pkg"
        class="space-y-2"
      >
        <h2 class="flex items-center gap-2 text-sm font-medium text-muted">
          {{ g.label }}
          <UBadge
            :label="String(g.names.length)"
            color="neutral"
            variant="subtle"
            size="sm"
          />
        </h2>
        <ul class="divide-y divide-default overflow-hidden rounded-lg border border-default">
          <li
            v-for="name in g.names"
            :key="name"
          >
            <NuxtLink
              :to="`/__review/${name}`"
              class="flex items-center justify-between px-3 py-3 transition-colors hover:bg-elevated active:bg-elevated"
            >
              <span class="truncate font-mono text-sm">{{ name }}</span>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 shrink-0 text-muted"
              />
            </NuxtLink>
          </li>
        </ul>
      </section>

      <p
        v-if="!shown"
        class="py-12 text-center text-sm text-muted"
      >
        Nothing matches “{{ query }}”.
      </p>
    </main>
  </div>
</template>
