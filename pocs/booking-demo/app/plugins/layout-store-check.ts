/**
 * The tiny `test` layout store behind /layout-store-check (#3650). Each copy
 * (`test`, `test#2`, one per scope) loads its starting value with a `useFetch`
 * keyed from `ctx.key`, so copies never share fetched data, and counts its own clicks.
 */
import type { ComputedRef } from 'vue'

interface TestStore {
  source: string
  count: ComputedRef<number>
  bump: () => void
}

const testStore = {
  id: 'test',
  setup(ctx: { key: string, source: string }): TestStore {
    const { data } = useFetch<{ count: number }>('/api/layout-store-check', {
      key: ctx.key,
      default: () => ({ count: 0 }),
    })
    const bumps = ref(0)
    const count = computed(() => (data.value?.count ?? 0) + bumps.value)
    return { source: ctx.source, count, bump: () => { bumps.value++ } }
  },
  feeds: {
    'store-check-counter': {
      props: (s: TestStore) => ({ count: s.count.value, label: s.source }),
      events: { bump: (s: TestStore) => s.bump() },
    },
  },
}

export default defineNuxtPlugin(() => {
  defineCroutonLayoutStore(testStore)
})
