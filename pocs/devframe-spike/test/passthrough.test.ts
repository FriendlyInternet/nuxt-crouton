import { describe, it, expect, vi } from 'vitest'
import { initDevframe } from 'devframe/initiate'
import { createCroutonDevframe } from '../server/devframe/definition'

async function boot(fetchJson: any) {
  const instance = initDevframe(createCroutonDevframe({ fetchJson }), { base: '/__crouton_df/', auth: false, mcp: { path: 'mcp' } })
  return instance
}
async function rpcCall(instance: any, tool: string, args: any = {}) {
  const res = await instance.handler(new Request('http://localhost/__crouton_df/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream', 'origin': 'http://localhost:3000' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })
  }))
  return res.text()
}

describe('passthrough', () => {
  it('list-collections returns the payload unchanged from the existing route', async () => {
    const payload = { collections: [{ name: 'a' }] }
    const fetchJson = vi.fn().mockResolvedValue(payload)
    const instance = await boot(fetchJson)
    const body = await rpcCall(instance, 'crouton-df_list-collections')
    expect(fetchJson).toHaveBeenCalledWith('/__nuxt_crouton_devtools/api/collections')
    const data = JSON.parse(body.split('data: ')[1]!.split('\n')[0]!)
    expect(JSON.parse(data.result.content[0].text)).toEqual(payload)
    await instance.close()
  })

  it('list-operations is not agent-exposed, so its handler is exercised directly', async () => {
    const fetchJson = vi.fn().mockResolvedValue([{ id: 1 }])
    const def = createCroutonDevframe({ fetchJson })
    const registered: any[] = []
    await def.setup({ rpc: { register: (f: any) => registered.push(f) } } as any)
    const ops = registered.find(f => f.name === 'crouton-df:list-operations')
    const out = await ops.handler({ collection: 'x', status: 'ok' })
    expect(out).toEqual([{ id: 1 }])
    expect(fetchJson).toHaveBeenCalledWith('/__nuxt_crouton_devtools/api/operations', { query: { collection: 'x', status: 'ok' } })
    await ops.handler({})
    expect(fetchJson).toHaveBeenLastCalledWith('/__nuxt_crouton_devtools/api/operations', { query: {} })
    const cols = registered.find(f => f.name === 'crouton-df:list-collections')
    expect(cols.type).toBe('query')
    expect(cols.agent).toBeTruthy()
    expect(ops.agent).toBeUndefined()
  })
})
