/**
 * #4108 — the translation APIs ask `translations:manage`, not a role name.
 *
 * A site that grants `pages:edit` to `member` does NOT open the translation
 * routes: that member is still refused (403) on translations-ui create/update/
 * delete and on settings/translations PATCH. The settings route used to call an
 * `isTeamAdmin` that exists nowhere, so every request was a 500; it now answers
 * through `requireCan(event, 'translations:manage')` and an admin can save.
 *
 * The REAL team lookup runs (helpers/teamFixture); the action is answered from
 * the fixture's role map the way the real `can()` answers from the site's roles.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fixture, installTeamFixture, fakeEvent } from '../../../__tests__/helpers/teamFixture'

vi.mock('#imports', () => ({ useRuntimeConfig: () => ({}) }))
vi.mock('@fyit/crouton-auth/server/utils/useServerAuth', () => ({
  requireServerSession: async () => ({ user: fixture.user, session: { activeOrganizationId: null } }),
  useServerAuth: () => ({})
}))
vi.mock('@fyit/crouton-auth/server/utils/team-auth', async () => {
  const { teamAuthModule } = await import('../../../__tests__/helpers/teamFixture')
  return teamAuthModule()
})

const db = installTeamFixture() as any
const writes = vi.fn(async (..._a: any[]) => ({ id: 't1' }))
// settings/translations reads the team's settings row (.get) and writes one (.run)
const settingsWrites: any[] = []
const baseSelect = db.select
db.select = () => ({
  from: (table: any) => ({
    where: (w: any) => ({ ...baseSelect().from(table).where(w), get: async () => undefined })
  })
})
db.insert = () => ({ values: (v: any) => ({ run: async () => { settingsWrites.push(v) } }) })

vi.stubGlobal('readBody', async () => ({ keyPath: 'a.b', category: 'ui', values: { en: 'x' }, translations: { en: { a: 'b' } } }))
vi.stubGlobal('getSystemTranslationByKeyPath', async () => null)
vi.stubGlobal('createTranslation', writes)
vi.stubGlobal('updateTranslation', writes)
vi.stubGlobal('deleteTranslation', writes)
vi.stubGlobal('verifyTeamTranslation', async () => ({}))
vi.stubGlobal('useNuxtApp', () => ({ hooks: { callHook: async () => {} } }))
vi.stubGlobal('getRouterParam', (e: any, n: string) => e.context.params[n])
vi.stubGlobal('getRouterParams', (e: any) => e.context.params)

const routes = {
  'translations-ui POST': '../[id]/translations-ui/index.post',
  'translations-ui PATCH': '../[id]/translations-ui/[translationId].patch',
  'translations-ui DELETE': '../[id]/translations-ui/[translationId].delete',
  'settings/translations PATCH': '../[id]/settings/translations.patch'
}
const ev = () => { const e = fakeEvent(); e.context.params.translationId = 't1'; return e }
const status = (e: any) => e?.statusCode ?? e?.status
const load = async (path: string) => (await import(/* @vite-ignore */ path)).default as any

beforeEach(() => {
  writes.mockClear()
  settingsWrites.length = 0
  fixture.asked.length = 0
  fixture.pathTeam = 'team-a'
  fixture.roles = { 'team-a': 'member' }
  // the site's roles: member may edit pages, nothing else
  fixture.grants = { owner: '*', admin: '*', member: ['pages:edit'] }
})

describe('member with pages:edit only (#4108)', () => {
  for (const [label, path] of Object.entries(routes)) {
    it(`${label}: 403, asked translations:manage, nothing written`, async () => {
      const h = await load(path)
      await expect(h(ev())).rejects.toSatisfy((e: any) => status(e) === 403)
      expect(fixture.asked).toEqual(['translations:manage'])
      expect(writes).not.toHaveBeenCalled()
      expect(settingsWrites).toHaveLength(0)
    })
  }
})

describe('settings/translations PATCH no longer crashes (#4108)', () => {
  it('admin saves the team translations', async () => {
    fixture.roles = { 'team-a': 'admin' }
    const h = await load(routes['settings/translations PATCH'])
    await expect(h(ev())).resolves.toMatchObject({ success: true })
    expect(settingsWrites).toEqual([expect.objectContaining({ teamId: 'team-a', translations: { en: { a: 'b' } } })])
  })

  it('a member granted translations:manage saves too', async () => {
    fixture.grants = { ...fixture.grants, member: ['translations:manage'] }
    const h = await load(routes['settings/translations PATCH'])
    await expect(h(ev())).resolves.toMatchObject({ success: true })
  })
})
