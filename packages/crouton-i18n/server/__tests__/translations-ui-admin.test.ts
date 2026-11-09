import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fixture, installTeamFixture, fakeEvent } from './helpers/teamFixture'

vi.mock('#imports', () => ({ useRuntimeConfig: () => ({}) }))
vi.mock('@fyit/crouton-auth/server/utils/useServerAuth', () => ({
  requireServerSession: async () => ({ user: fixture.user, session: { activeOrganizationId: null } }),
  useServerAuth: () => ({})
}))

installTeamFixture()
const writes = vi.fn(async () => ({ id: 't1' }))
vi.stubGlobal('readBody', async () => ({ keyPath: 'a.b', category: 'ui', values: { en: 'x' } }))
vi.stubGlobal('getSystemTranslationByKeyPath', async () => null)
vi.stubGlobal('createTranslation', writes)
vi.stubGlobal('updateTranslation', writes)
vi.stubGlobal('deleteTranslation', writes)
vi.stubGlobal('verifyTeamTranslation', async () => ({}))
vi.stubGlobal('useNuxtApp', () => ({ hooks: { callHook: async () => {} } }))
vi.stubGlobal('getRouterParam', (e: any, n: string) => e.context.params[n])

const routes = {
  POST: '../api/teams/[id]/translations-ui/index.post',
  PATCH: '../api/teams/[id]/translations-ui/[translationId].patch',
  DELETE: '../api/teams/[id]/translations-ui/[translationId].delete'
}
const ev = () => { const e = fakeEvent(); e.context.params.translationId = 't1'; return e }
const status = (e: any) => e?.statusCode ?? e?.status

beforeEach(() => { writes.mockClear(); fixture.pathTeam = 'team-a' })

for (const [method, path] of Object.entries(routes)) {
  describe(`translations-ui ${method}`, () => {
    it('member -> 403, no write', async () => {
      fixture.roles = { 'team-a': 'member' }
      const h = (await import(/* @vite-ignore */ path)).default as any
      await expect(h(ev())).rejects.toSatisfy((e: any) => status(e) === 403)
      expect(writes).not.toHaveBeenCalled()
    })
    it('admin of another team -> 403, no write', async () => {
      fixture.roles = { 'team-b': 'admin' }
      const h = (await import(/* @vite-ignore */ path)).default as any
      await expect(h(ev())).rejects.toSatisfy((e: any) => status(e) === 403)
      expect(writes).not.toHaveBeenCalled()
    })
    it('admin -> writes', async () => {
      fixture.roles = { 'team-a': 'admin' }
      const h = (await import(/* @vite-ignore */ path)).default as any
      await h(ev())
      expect(writes).toHaveBeenCalled()
    })
  })
}
