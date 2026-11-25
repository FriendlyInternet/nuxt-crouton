import { describe, it, expect, vi, beforeEach } from 'vitest'

const addServerHandler = vi.fn()
vi.mock('@nuxt/kit', () => ({
  defineNuxtModule: (d: any) => d,
  createResolver: () => ({ resolve: (p: string) => p }),
  addServerHandler
}))
vi.mock('@nuxt/devtools-kit', () => ({ onDevtoolsReady: vi.fn() }))

beforeEach(() => addServerHandler.mockClear())

async function run(dev: boolean) {
  const hook = vi.fn()
  const nuxt: any = { options: { dev, runtimeConfig: {} }, hook }
  const mod: any = (await import('../modules/crouton-devframe')).default
  mod.setup({}, nuxt)
  return { hook, nuxt }
}

describe('dev-only registration', () => {
  it('registers nothing when dev is false', async () => {
    const { hook } = await run(false)
    expect(hook).not.toHaveBeenCalled()
    expect(addServerHandler).not.toHaveBeenCalled()
  })

  it('registers the nitro plugin via nitro:config and the handler when dev is true', async () => {
    const { hook } = await run(true)
    const call = hook.mock.calls.find(c => c[0] === 'nitro:config')
    expect(call).toBeTruthy()
    const cfg: any = {}
    call![1](cfg)
    expect(cfg.plugins).toEqual(['../server/devframe/plugin'])
    expect(addServerHandler).toHaveBeenCalledOnce()
  })
})
