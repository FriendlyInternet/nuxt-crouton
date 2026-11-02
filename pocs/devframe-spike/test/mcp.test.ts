import { describe, it, expect, afterAll } from 'vitest'
import { initDevframe } from 'devframe/initiate'
import { createCroutonDevframe } from '../server/devframe/definition'

const instance = initDevframe(createCroutonDevframe({ fetchJson: async () => ({}) as any }), {
  base: '/__crouton_df/', auth: false, mcp: { path: 'mcp' }
})
afterAll(() => instance.close())

const list = (origin: string) => instance.handler(new Request('http://localhost/__crouton_df/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream', origin },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
}))

describe('MCP route', () => {
  it('exposes only list-collections as a crouton tool (plus built-in state tool)', async () => {
    const res = await list('http://localhost:3000')
    expect(res.status).toBe(200)
    const text = await res.text()
    const names = [...text.matchAll(/"name":"([^"]+)"/g)].map(m => m[1])
    expect(names).toContain('crouton-df_list-collections')
    expect(names.some(n => n.includes('list-operations'))).toBe(false)
    expect(names.filter(n => n.startsWith('crouton-df'))).toEqual(['crouton-df_list-collections'])
    expect(names.filter(n => !n.startsWith('crouton-df'))).toEqual(['devframe_state_read'])
  })

  it('rejects a foreign Origin', async () => {
    expect((await list('http://evil.com')).status).toBe(403)
  })
})
