import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  member: { team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'admin' } },
  create: vi.fn(async (d: any) => d)
}))

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({ resolveTeamAndCheckMembership: async () => hoisted.member }))
vi.mock('../collections/assets/server/database/queries', () => ({ createCroutonAsset: hoisted.create, updateCroutonAsset: vi.fn() }))

let body: unknown

beforeEach(() => {
  hoisted.create.mockClear()
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('readValidatedBody', async (_e: any, parse: (b: unknown) => unknown) => parse(body))
})
afterEach(() => vi.unstubAllGlobals())

const run = async () => (await import('../collections/assets/server/api/teams/[id]/crouton-assets/index.post')).default({})

describe('assets body validation (#3377)', () => {
  it('rejects a wrong-typed size', async () => {
    body = { filename: 'a.png', pathname: 'a.png', size: 'big' }
    await expect(run()).rejects.toThrow()
    expect(hoisted.create).not.toHaveBeenCalled()
  })

  it('ignores a client-supplied userId', async () => {
    body = { filename: 'a.png', pathname: 'a.png', size: 10, userId: 'evil', teamId: 'other' }
    await run()
    const arg = hoisted.create.mock.calls[0]![0]
    expect(arg.userId).toBe('u1')
    expect(arg.teamId).toBe('t1')
  })
})
