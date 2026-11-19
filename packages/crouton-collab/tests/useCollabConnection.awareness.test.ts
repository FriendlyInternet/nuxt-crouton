import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// #3984 — the REAL useCollabConnection carries the awareness adapter: what the editor
// sets goes out over the socket, and the room's `users` broadcast comes back into
// `awareness.getStates()`. Only the browser WebSocket and Nuxt's runtime config are
// stand-ins (there is no browser socket or Nuxt app in vitest).

class FakeSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static instances: FakeSocket[] = []
  readyState = FakeSocket.CONNECTING
  binaryType = ''
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(public url: string) { FakeSocket.instances.push(this) }
  send(data: unknown) { this.sent.push(data) }
  close() { this.readyState = 3 }
  open() { this.readyState = FakeSocket.OPEN; this.onopen?.() }
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { collabWorkerUrl: '' } }))
})
afterEach(() => { vi.unstubAllGlobals() })

const { useCollabConnection } = await import('../app/composables/useCollabConnection')

const awarenessFrames = (s: FakeSocket) =>
  s.sent.filter((d): d is string => typeof d === 'string').map(d => JSON.parse(d))

describe('useCollabConnection awareness (#3984)', () => {
  it('sends the editor\'s state through the socket and exposes the room\'s users as states', async () => {
    const conn = useCollabConnection({ roomId: 'p1', roomType: 'pagesPages', teamId: 't1', autoConnect: false })
    await conn.connect()
    const socket = FakeSocket.instances[0]!
    socket.open()

    conn.awareness.setLocalStateField('user', { id: 'owner', name: 'Owner' })
    await tick()

    const frames = awarenessFrames(socket)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      type: 'awareness',
      userId: 'owner',
      state: { user: { id: 'owner', name: 'Owner' }, clientId: conn.ydoc.clientID, cursor: null }
    })

    const listener = vi.fn()
    conn.awareness.on('change', listener)
    socket.onmessage!({ data: JSON.stringify({ type: 'awareness', users: [
      frames[0].state,
      { user: { id: 'peer', name: 'Peer', color: 'hsl(120, 65%, 45%)' }, cursor: null, clientId: 99, caret: null }
    ] }) })

    expect(listener).toHaveBeenCalledTimes(1)
    expect([...conn.awareness.getStates().keys()].sort()).toEqual([99, conn.ydoc.clientID].sort())
    expect((conn.awareness.getStates().get(99) as any).user.color).toBe('#28bd28')
  })

  it('re-announces the last state when the socket (re)opens', async () => {
    const conn = useCollabConnection({ roomId: 'p1', roomType: 'pagesPages', teamId: 't1', autoConnect: false })
    conn.awareness.setLocalStateField('user', { id: 'owner', name: 'Owner' })
    await tick() // sent before any socket exists → dropped
    await conn.connect()
    const socket = FakeSocket.instances[0]!
    socket.open()
    expect(awarenessFrames(socket)).toHaveLength(1)
    expect(awarenessFrames(socket)[0].state.user.id).toBe('owner')
  })
})
