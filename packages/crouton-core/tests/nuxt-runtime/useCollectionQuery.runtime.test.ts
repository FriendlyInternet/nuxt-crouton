import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, computed } from 'vue'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { useCollectionQuery } from '../../app/composables/useCollectionQuery'

// Real Nuxt runtime: real useFetch / useAsyncData, requests counted at the endpoint.
// Nuxt's test env may prefix paths with `/_`; strip it so assertions read as the real URL.
const hits: string[] = []
const record = (p: string) => hits.push(p.replace(/^\/_(?=\/api)/, ''))
const team = ref<string | null>(null)

registerEndpoint('/api/teams/t1/products', (e) => {
  record(e.path)
  const q = new URL(e.path, 'http://x').searchParams.get('status')
  return [{ q: `status=${q}` }]
})
registerEndpoint('/api/__skip__', (e) => {
  record(e.path)
  return []
})

const mounted: Array<{ unmount: () => void }> = []
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise(r => setTimeout(r, 20))
  }
}

async function mountList(status: ReturnType<typeof ref<string>>) {
  let result: Awaited<ReturnType<typeof useCollectionQuery>>
  mounted.push(await mountSuspended(defineComponent({
    async setup() {
      result = await useCollectionQuery('products', {
        query: computed(() => ({ status: status.value }))
      })
      return () => h('div')
    }
  })))
  return result!
}

describe('useCollectionQuery (real Nuxt runtime)', () => {
  afterEach(() => {
    mounted.splice(0).forEach(w => w.unmount())
  })

  beforeEach(() => {
    hits.length = 0
    team.value = null
    vi.stubGlobal('useCollections', () => ({ getConfig: () => ({ apiPath: 'products' }) }))
    vi.stubGlobal('useTeamContext', () => ({ getTeamId: () => team.value }))
    vi.stubGlobal('useRemoteCollectionRefresh', () => {})
  })

  it('makes no request while waiting for a team', async () => {
    const status = ref('a')
    const list = await mountList(status)
    status.value = 'b'
    await flush()
    await list.refresh()
    team.value = null
    status.value = 'c'
    await flush()
    expect(hits).toEqual([])
  })

  it('fetches once the team appears', async () => {
    const status = ref('b')
    const list = await mountList(status)
    await flush()
    expect(hits).toEqual([])
    team.value = 't1'
    await flush()
    expect(hits).toEqual(['/api/teams/t1/products?status=b'])
    expect(list.items.value).toEqual([{ q: 'status=b' }])
  })

  it('two lists with different filters keep their own data', async () => {
    team.value = 't1'
    const a = ref('a')
    const b = ref('a')
    const listA = await mountList(a)
    const listB = await mountList(b)
    await flush()
    a.value = 'b'
    await flush()
    expect(listA.items.value).toEqual([{ q: 'status=b' }])
    expect(listB.items.value).toEqual([{ q: 'status=a' }])
  })
})
