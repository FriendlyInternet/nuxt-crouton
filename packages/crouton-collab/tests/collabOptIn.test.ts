/**
 * Live-sync opt-in (#3810): an app that hasn't opted into live sync (no
 * `collabWorkerUrl` in its built client) must behave as if crouton-collab isn't there —
 * no socket, no token fetch, no presence. Local dev keeps the same-host route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useCollabConnection, isCollabEnabled } from '../app/composables/useCollabConnection'
import { useFormCollabPresence } from '../app/composables/useFormCollabPresence'
import CollabPresence from '../app/components/CollabPresence.vue'

// Plugins call defineNuxtPlugin at import time, so it must exist before they load
;(globalThis as any).defineNuxtPlugin = (fn: any) => fn
const collectionSyncPlugin = (await import('../app/plugins/collection-sync.client')).default
const formCollabPlugin = (await import('../app/plugins/form-collab.client')).default

let workerUrl = ''
let built: string[] = []
let fetchSpy: ReturnType<typeof vi.fn>
let afterEachSpy: ReturnType<typeof vi.fn>

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = 0
  binaryType = ''
  onopen: any = null
  onmessage: any = null
  onclose: any = null
  onerror: any = null
  constructor(public url: string) {
    built.push(url)
  }

  send() {}
  close() {}
}

beforeEach(() => {
  workerUrl = ''
  built = []
  fetchSpy = vi.fn().mockResolvedValue({ token: 'tok', teamId: 't' })
  afterEachSpy = vi.fn()
  vi.stubEnv('DEV', false)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { collabWorkerUrl: workerUrl } }))
  vi.stubGlobal('$fetch', fetchSpy)
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('useTeamContext', () => ({ teamId: ref('t') }))
  vi.stubGlobal('useCrouton', () => ({
    croutonStates: ref([{ id: 's1', action: 'update', isOpen: true, collection: 'posts', activeItem: { id: '1' } }])
  }))
  vi.stubGlobal('useRouter', () => ({ afterEach: afterEachSpy }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function fakeNuxtApp() {
  return { hook: vi.fn(), callHook: vi.fn(), payload: { data: {} } }
}

describe('live-sync opt-in (#3810)', () => {
  it('an app without the opt-in opens no socket', async () => {
    const conn = useCollabConnection({ roomId: 'r', roomType: 'sync', teamId: 't', autoConnect: false })
    await conn.connect()
    await Promise.resolve()
    expect(built).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(conn.error.value).toBeNull()
  })

  it('…and the team sync plugin stays quiet', async () => {
    const nuxtApp = fakeNuxtApp()
    ;(collectionSyncPlugin as any)(nuxtApp)
    await Promise.resolve()
    expect(built).toEqual([])
    expect(afterEachSpy).not.toHaveBeenCalled()
    expect(nuxtApp.hook).not.toHaveBeenCalled()
  })

  it('…and an open edit form shows no presence', async () => {
    const { activeConnections } = useFormCollabPresence()
    expect(built).toEqual([])
    expect(activeConnections.value.size).toBe(0)

    ;(formCollabPlugin as any)(fakeNuxtApp())
    expect(built).toEqual([])

    const wrapper = mount(CollabPresence, { props: { users: [] }, global: { stubs: { UTooltip: true } } })
    expect(wrapper.find('.collab-presence').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('an opted-in app still connects to its worker', async () => {
    workerUrl = 'https://w.example'
    const conn = useCollabConnection({ roomId: 'r', roomType: 'sync', teamId: 't', autoConnect: false })
    await conn.connect()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/collab/token')
    expect(built).toHaveLength(1)
    expect(built[0].startsWith('wss://w.example/')).toBe(true)
    expect(built[0]).toContain('&token=tok')

    built = []
    useFormCollabPresence()
    expect(built).toEqual([])
  })

  it('local dev still connects to the same host', async () => {
    vi.stubEnv('DEV', true)
    const conn = useCollabConnection({ roomId: 'r', roomType: 'sync', teamId: 't', autoConnect: false })
    await conn.connect()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(built).toHaveLength(1)
    expect(built[0]).toContain('/api/collab/r/ws')
    expect(built[0]).toContain(`//${window.location.host}/`)

    built = []
    useFormCollabPresence()
    expect(built).toHaveLength(1)
    expect(built[0]).toContain('/api/collab/posts-1/ws?type=posts')
  })

  it('isCollabEnabled decides opt-in from the worker URL, or local dev', () => {
    expect(isCollabEnabled('', false)).toBe(false)
    expect(isCollabEnabled(undefined, false)).toBe(false)
    expect(isCollabEnabled('', true)).toBe(true)
    expect(isCollabEnabled('https://w', false)).toBe(true)
  })
})
