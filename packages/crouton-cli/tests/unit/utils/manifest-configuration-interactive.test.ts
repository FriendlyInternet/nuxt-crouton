import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const prompts = vi.hoisted(() => ({
  note: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
  multiselect: vi.fn(),
  text: vi.fn(),
  isCancel: (v: unknown) => v === Symbol.for('cancel'),
}))
vi.mock('@clack/prompts', () => prompts)

vi.mock('../../../lib/utils/manifest-loader.ts', () => ({
  discoverManifests: async () => [{
    id: 'crouton-widgets',
    runtimeConfigKey: 'widgets',
    configuration: {
      'on': { type: 'boolean', label: 'On', description: 'Enable it', default: true },
      'mode.kind': { type: 'select', label: 'Kind', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' },
      'tags': { type: 'multiselect', label: 'Tags', options: [{ value: 'x', label: 'X' }], default: [] },
      'name': { type: 'string', label: 'Name', default: 'w' },
      'limit': { type: 'number', label: 'Limit', default: 5 },
    },
  }],
}))

import { applyManifestConfiguration } from '../../../lib/utils/manifest-configuration.ts'

// The interactive path: a TTY and no CI flag, so the manifest's setup questions are actually asked.
let prevCI: string | undefined
let prevTTY: boolean | undefined
beforeEach(() => {
  prevCI = process.env.CI
  prevTTY = process.stdout.isTTY
  delete process.env.CI
  process.stdout.isTTY = true
  Object.values(prompts).forEach(fn => typeof fn === 'function' && 'mockReset' in fn && (fn as any).mockReset())
})
afterEach(() => {
  if (prevCI === undefined) delete process.env.CI; else process.env.CI = prevCI
  process.stdout.isTTY = prevTTY as boolean
})

describe('applyManifestConfiguration — interactive prompts', () => {
  it('asks each option by its type and stores the answers', async () => {
    prompts.confirm.mockResolvedValue(false)
    prompts.select.mockResolvedValue('b')
    prompts.multiselect.mockResolvedValue(['x'])
    prompts.text.mockResolvedValueOnce('hello').mockResolvedValueOnce('12')

    const config: { features?: Record<string, unknown> } = {}
    const [pc] = await applyManifestConfiguration(config, ['crouton-widgets'])

    expect(pc.configObject).toEqual({ config: { on: false, mode: { kind: 'b' }, tags: ['x'], name: 'hello', limit: 12 } })
    expect(config.features?.widgets).toBe(pc.configObject)
    expect(prompts.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'On — Enable it', initialValue: true }))
    expect(pc.runtimeConfig?.server).toEqual({ widgets: pc.configObject.config })
  })

  it('leaves the feature unconfigured when the user cancels', async () => {
    prompts.confirm.mockResolvedValue(Symbol.for('cancel'))

    const config = { features: { widgets: true } as Record<string, unknown> }
    expect(await applyManifestConfiguration(config, ['crouton-widgets'])).toEqual([])
    expect(config.features.widgets).toBe(true)
    expect(prompts.cancel).toHaveBeenCalled()
  })
})
