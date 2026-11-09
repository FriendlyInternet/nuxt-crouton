/**
 * #1958 — a person field (`refScope: 'external'`, `refTarget: 'users'`) is picked from, shown
 * from, validated against and seeded from the caller's team members.
 * Rule under test: a person field only ever stores a member of the caller's team.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { transformSync } from 'esbuild'
import { generateFormComponent } from '../../../lib/generators/form-component.ts'
import { generateListComponent } from '../../../lib/generators/list-component.ts'
import { generateQueries, buildPersonRefCheck } from '../../../lib/generators/database-queries.ts'
import { generatePostEndpoint, generatePatchEndpoint } from '../../../lib/generators/api-endpoints.ts'
import { generateApiTest } from '../../../lib/generators/api-test.ts'
import { generateSeedFixture } from '../../../lib/generators/collection-seed-fixture.ts'
import { collectCollectionFixtureSql } from '../../../lib/seed-app.ts'
import * as core from '../../../../crouton-core/shared/seed/index.ts'
import { apiEndpointData, formComponentData, minimalConfig, withComponent } from '../../fixtures/sample-data.mjs'
import { withManifest } from '../../helpers/manifest-fields.ts'

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2025-01-01'))
})
afterAll(() => {
  vi.useRealTimers()
})

const personFields = [
  { name: 'name', type: 'string', meta: { required: true } },
  { name: 'assigneeId', type: 'string', refTarget: 'users', refScope: 'external', meta: {} },
  { name: 'reviewerIds', type: 'array', refTarget: 'users', refScope: 'external', meta: {} },
]
const base = { layer: 'main', layerPascalCase: 'Main', layerCamelCase: 'main' }
const formData = { ...formComponentData, ...base, fields: withComponent(personFields) }
const apiData = { ...apiEndpointData, ...base, fields: personFields }
const plainData = {
  ...apiEndpointData,
  ...base,
  fields: [
    { name: 'name', type: 'string', meta: {} },
    { name: 'categoryId', type: 'string', refTarget: 'categories', meta: {} },
  ],
}

describe('person field only stores a member of the caller team', () => {
  const code = buildPersonRefCheck(personFields.slice(1), 'MainProduct').replace('export ', '')
  const js = transformSync(code, { loader: 'ts' }).code
  const members: Record<string, string[]> = { teamA: ['alice', 'bob'], teamB: ['mallory'] }
  const calls: Array<[string, string]> = []
  const getMembership = async (_e: unknown, teamId: string, userId: string) => {
    calls.push([teamId, userId])
    return members[teamId]?.includes(userId) ? { userId } : null
  }
  const createError = (o: Record<string, unknown>) => Object.assign(new Error(String(o.statusText)), o)
  const check = new Function('getMembership', 'createError', `${js}; return assertMainProductTeamMembers`)(getMembership, createError) as
    (e: unknown, teamId: string, data: Record<string, unknown>) => Promise<void>
  const rejection = { status: 400 }

  it('accepts a team member', async () => {
    await expect(check({}, 'teamA', { assigneeId: 'alice' })).resolves.toBeUndefined()
  })
  it('rejects another team\'s user and an unknown id identically', async () => {
    await expect(check({}, 'teamA', { assigneeId: 'mallory' })).rejects.toMatchObject({ ...rejection, statusText: 'Invalid reference: assigneeId' })
    await expect(check({}, 'teamA', { assigneeId: 'ghost' })).rejects.toMatchObject({ ...rejection, statusText: 'Invalid reference: assigneeId' })
  })
  it('checks against the caller team, not any team', async () => {
    calls.length = 0
    await expect(check({}, 'teamB', { assigneeId: 'mallory' })).resolves.toBeUndefined()
    expect(calls).toEqual([['teamB', 'mallory']])
  })
  it('handles arrays: all members pass (deduped), one outsider fails', async () => {
    calls.length = 0
    await expect(check({}, 'teamA', { reviewerIds: ['alice', 'alice', 'bob'] })).resolves.toBeUndefined()
    expect(calls).toHaveLength(2)
    await expect(check({}, 'teamA', { reviewerIds: ['alice', 'mallory'] })).rejects.toMatchObject({ statusText: 'Invalid reference: reviewerIds' })
  })
  it('skips empty values without a lookup', async () => {
    calls.length = 0
    for (const v of [undefined, null, '']) await check({}, 'teamA', { assigneeId: v })
    expect(calls).toHaveLength(0)
  })
  it('rejects wrong shapes', async () => {
    for (const v of [5, {}]) await expect(check({}, 'teamA', { assigneeId: v })).rejects.toMatchObject(rejection)
    await expect(check({}, 'teamA', { reviewerIds: ['alice', 7] })).rejects.toMatchObject(rejection)
  })
})

describe('person field wiring', () => {
  it('form renders a team member picker, script emitted once', () => {
    const out = generateFormComponent(formData, minimalConfig as any)
    expect(out).toContain('v-model="state.assigneeId"')
    expect(out).toContain(':items="teamMemberItems"')
    expect(out).toContain('multiple')
    expect(out).not.toContain('collection="mainUsers"')
    expect(out.match(/useTeam\(\)/g)).toHaveLength(1)
  })

  it('list shows the joined person', () => {
    const out = generateListComponent(formData, minimalConfig as any)
    expect(out).toContain(':item="row.original.assigneeIdUser"')
    expect(out).toContain('CroutonUsersCardMini')
    // single person field no longer points at the non-existent users collection (array fields keep the old path for now)
    expect(out).not.toMatch(/assigneeId-cell[\s\S]{0,200}collection="mainUsers"/)
  })

  it('queries carry the check and the getMembership import only for person fields', () => {
    const out = generateQueries(apiData)
    expect(out).toContain('assertMainProductTeamMembers')
    expect(out).toContain("import { getMembership } from '@fyit/crouton-auth/server/utils/team'")
    const plain = generateQueries(plainData)
    expect(plain).not.toContain('getMembership')
    expect(plain).not.toContain('TeamMembers')
  })

  it('POST/PATCH call the check, and the api test mocks it', () => {
    for (const out of [generatePostEndpoint(apiData, minimalConfig as any), generatePatchEndpoint(apiData, minimalConfig as any)]) {
      expect(out).toContain('await assertMainProductTeamMembers(event, team.id, body)')
      expect(out).not.toContain('assertMainProductReferences')
    }
    expect(generateApiTest(apiData, minimalConfig as any)).toContain('assertMainProductTeamMembers: vi.fn()')
  })

  it('does not regress a plain local reference', () => {
    const post = generatePostEndpoint(plainData, minimalConfig as any)
    expect(post).toContain('assertShopProductReferences(team.id, body)'.replace('Shop', 'Main'))
    expect(post).not.toContain('TeamMembers')
  })
})

describe('person field seed', () => {
  it('fixture lists person fields and carries no value for them', () => {
    const fixture = generateSeedFixture({ layer: 'main', plural: 'tasks', fields: withManifest(personFields) })!
    expect(fixture.personFields).toEqual(['assigneeId', 'reviewerIds'])
    expect(Object.keys(fixture.rows[0])).not.toContain('assigneeId')
  })

  it('seed SQL fills person fields from a real team member', () => {
    const dir = mkdtempSync(join(tmpdir(), 'person-seed-'))
    try {
      const d = join(dir, 'layers', 'main', 'collections', 'tasks')
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'seed.json'), JSON.stringify({ table: 'main_tasks', key: 'name', rows: [{ name: 'a' }], personFields: ['assigneeId'] }))
      const sql = collectCollectionFixtureSql(dir, core, 'team1')
      expect(sql).toContain(`(SELECT "userId" FROM "member" WHERE "organizationId" = 'team1'`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
