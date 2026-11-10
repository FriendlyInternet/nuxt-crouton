/**
 * #1958 — a person field (`refScope: 'external'` + `refTarget: 'users'`) gets a team-member picker,
 * a name in the list, a membership check on the API, and a real member in the seed.
 * The rule: a person field only ever stores a member of the caller's team.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// Node's built-in type stripper (no extra dependency) turns the generated TS into runnable JS.
import { stripTypeScriptTypes } from 'node:module'
import { generateFormComponent } from '../../../lib/generators/form-component.ts'
import { generateListComponent } from '../../../lib/generators/list-component.ts'
import { generateQueries, buildPersonRefCheck } from '../../../lib/generators/database-queries.ts'
import { generatePostEndpoint, generatePatchEndpoint } from '../../../lib/generators/api-endpoints.ts'
import { generateApiTest } from '../../../lib/generators/api-test.ts'
import { generateSeedFixture } from '../../../lib/generators/collection-seed-fixture.ts'
import { collectCollectionFixtureSql } from '../../../lib/seed-app.ts'
import { collectPersonRefFields, isPersonRef } from '../../../lib/utils/team-ref-fields.ts'
import * as core from '../../../../crouton-core/shared/seed/index.ts'
import { formComponentData, minimalConfig, withComponent, apiEndpointData } from '../../fixtures/sample-data.mjs'

const person = { name: 'assigneeId', type: 'string', refTarget: 'users', refScope: 'external', meta: {} }
const personArr = { name: 'reviewerIds', type: 'array', refTarget: 'users', refScope: 'external', meta: {} }
const nameField = { name: 'name', type: 'string', meta: { required: true } }

const base = {
  ...formComponentData,
  ...apiEndpointData,
  singular: 'task',
  plural: 'tasks',
  camelCase: 'task',
  camelCasePlural: 'tasks',
  pascalCase: 'Task',
  pascalCasePlural: 'Tasks',
  layer: 'main',
  layerPascalCase: 'Main',
  layerCamelCase: 'main',
  collectionLayerMap: new Map(),
}
const mk = (fields: any[]) => ({ ...base, fields: withComponent(fields) })

describe('person field only stores a member of the caller team', () => {
  const code = buildPersonRefCheck([person, personArr], 'MainTasks').replace('export ', '')
  const js = stripTypeScriptTypes(code)
  const members: Record<string, string[]> = { teamA: ['alice', 'bob'], teamB: ['mallory'] }
  function setup() {
    const calls: Array<[string, string]> = []
    const getMembership = async (_e: any, teamId: string, userId: string) => {
      calls.push([teamId, userId])
      return members[teamId]?.includes(userId) ? { id: 'm' } : null
    }
    const createError = (o: any) => Object.assign(new Error(o.statusText), o)
    const check = new Function('getMembership', 'createError', `${js}; return assertMainTasksTeamMembers`)(getMembership, createError)
    return { check, calls }
  }
  const bad = { status: 400, statusText: 'Invalid reference: assigneeId' }

  it('accepts a team-A member', async () => {
    await expect(setup().check({}, 'teamA', { assigneeId: 'alice' })).resolves.toBeUndefined()
  })
  it('rejects a team-B user', async () => {
    await expect(setup().check({}, 'teamA', { assigneeId: 'mallory' })).rejects.toMatchObject(bad)
  })
  it('rejects an unknown id the same way', async () => {
    await expect(setup().check({}, 'teamA', { assigneeId: 'ghost' })).rejects.toMatchObject(bad)
  })
  it('checks against the caller team', async () => {
    const { check, calls } = setup()
    await expect(check({}, 'teamB', { assigneeId: 'mallory' })).resolves.toBeUndefined()
    await expect(check({}, 'teamA', { assigneeId: 'mallory' })).rejects.toMatchObject(bad)
    expect(calls).toEqual([['teamB', 'mallory'], ['teamA', 'mallory']])
  })
  it('accepts arrays of members, one lookup per distinct id', async () => {
    const { check, calls } = setup()
    await check({}, 'teamA', { reviewerIds: ['alice', 'bob'] })
    await check({}, 'teamA', { reviewerIds: ['alice', 'alice'] })
    expect(calls).toHaveLength(3)
  })
  it('rejects an array with one outsider', async () => {
    await expect(setup().check({}, 'teamA', { reviewerIds: ['alice', 'mallory'] }))
      .rejects.toMatchObject({ status: 400, statusText: 'Invalid reference: reviewerIds' })
  })
  it('skips the lookup for empty values', async () => {
    const { check, calls } = setup()
    for (const v of [undefined, null, '']) await check({}, 'teamA', { assigneeId: v })
    expect(calls).toHaveLength(0)
  })
  it('rejects wrong shapes', async () => {
    const { check } = setup()
    await expect(check({}, 'teamA', { assigneeId: 5 })).rejects.toMatchObject({ status: 400 })
    await expect(check({}, 'teamA', { assigneeId: {} })).rejects.toMatchObject({ status: 400 })
    await expect(check({}, 'teamA', { reviewerIds: ['alice', 7] })).rejects.toMatchObject({ status: 400 })
  })
})

describe('person field wiring', () => {
  it('predicate', () => {
    expect(isPersonRef(person)).toBe(true)
    expect(isPersonRef({ name: 'x', refTarget: 'users' })).toBe(false)
    expect(collectPersonRefFields({ fields: [nameField, person] })).toHaveLength(1)
  })

  it('form renders a team member picker, script once', () => {
    const out = generateFormComponent(mk([nameField, person, personArr]), minimalConfig as any)
    expect(out).toContain('v-model="state.assigneeId"')
    expect(out).toContain(':items="teamMemberItems"')
    expect(out).not.toContain('collection="mainUsers"')
    expect(out.match(/useTeam\(\)/g)).toHaveLength(1)
    expect(out).toMatch(/v-model="state.reviewerIds"[^>]*multiple/)
  })

  it('list shows the person name', () => {
    const out = generateListComponent(mk([nameField, person]), minimalConfig as any)
    expect(out).toContain('CroutonUsersCardMini')
    expect(out).toContain(':item="row.original.assigneeIdUser"')
    expect(out).not.toContain('collection="mainUsers"')
  })

  it('queries carry the check only with a person field', () => {
    const withP = generateQueries(mk([nameField, person]), null, 'main', new Map(), new Map())
    expect(withP).toContain("assertMainTaskTeamMembers")
    expect(withP).toContain("import { getMembership } from '@fyit/crouton-auth/server/utils/team'")
    const without = generateQueries(mk([nameField]), null, 'main', new Map(), new Map())
    expect(without).not.toContain('getMembership')
  })

  it('endpoints call the check, and the api test mocks it', () => {
    const d = mk([nameField, person])
    for (const out of [generatePostEndpoint(d, minimalConfig as any), generatePatchEndpoint(d, minimalConfig as any)]) {
      expect(out).toContain('await assertMainTaskTeamMembers(event, team.id, body)')
      expect(out).not.toContain('References(team.id, body)')
    }
    expect(generateApiTest(d, minimalConfig as any)).toContain('assertMainTaskTeamMembers: vi.fn()')
  })

  it('plain local ref is unchanged', () => {
    const d = mk([nameField, { name: 'categoryId', type: 'string', refTarget: 'categories', meta: {} }])
    expect(generateFormComponent(d, minimalConfig as any)).toContain('CroutonFormReferenceSelect')
    expect(generatePostEndpoint(d, minimalConfig as any)).not.toContain('TeamMembers')
  })

  it('seed fixture lists person fields and the runner fills a member subquery', () => {
    const fixture = generateSeedFixture(mk([nameField, person]))!
    expect(fixture.personFields).toEqual(['assigneeId'])
    expect(fixture.rows[0]).not.toHaveProperty('assigneeId')

    const dir = mkdtempSync(join(tmpdir(), 'person-seed-'))
    try {
      mkdirSync(join(dir, 'layers/main/collections/tasks'), { recursive: true })
      writeFileSync(join(dir, 'layers/main/collections/tasks/seed.json'), JSON.stringify(fixture))
      const sql = collectCollectionFixtureSql(dir, core, 'team1')
      expect(sql).toContain(`(SELECT "userId" FROM "member" WHERE "organizationId" = 'team1'`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
