import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, watch, toValue, nextTick } from 'vue'

// #4565: the chart's labels follow the page language — useCollectionChart sends
// the current locale in the query and refetches when it changes. Only the Nuxt
// auto-imports are stand-ins; the debounce runs immediately so the test is sync.
vi.mock('@vueuse/core', () => ({ useDebounceFn: (fn: (...a: any[]) => any) => (...a: any[]) => fn(...a) }))

const locale = ref('fr')
const fetchMock = vi.fn(async (_url: string, _opts: { query: Record<string, unknown> }) => ({ items: [{ slot: 'Matin', count: 2 }] }))

beforeEach(() => {
  locale.value = 'fr'
  fetchMock.mockClear()
  const g = globalThis as any
  g.ref = ref
  g.computed = computed
  g.watch = watch
  g.toValue = toValue
  g.useCollections = () => ({ getConfig: () => null })
  g.useTeamContext = () => ({ teamId: ref('t1') })
  g.useChartPalette = () => ({ colorAt: () => '#000' })
  g.useI18n = () => ({ locale })
  g.$fetch = fetchMock
})

const flush = async () => {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('useCollectionChart locale', () => {
  // covers: T6
  it('sends the locale and refetches with the new one when the language switches', async () => {
    const { useCollectionChart } = await import('../app/composables/useCollectionChart')
    const { chartData } = useCollectionChart('', { apiPath: '/api/crouton-bookings/teams/{teamId}/charts/bookings-by-slot', xField: 'slot', yFields: ['count'] })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/crouton-bookings/teams/t1/charts/bookings-by-slot')
    expect(fetchMock.mock.calls[0]![1].query).toMatchObject({ locale: 'fr' })
    expect(chartData.value).toEqual([{ slot: 'Matin', count: 2 }])

    locale.value = 'nl'
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.at(-1)![1].query).toMatchObject({ locale: 'nl' })
  })
})
