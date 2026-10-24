// Generator for a per-collection API route handler test (<Collection>.api.test.ts).
//
// Emitted next to each generated collection (#785/#791) alongside the schema-smoke
// test (#788). Where the schema-smoke proves the Zod schema, this proves the
// generated endpoint *handlers* — the runtime logic most likely to regress:
//
//   • team-scoping — an unauthenticated request is rejected and never writes;
//     the happy path calls the query with the resolved team's id (flip the
//     `teamId: team.id` in a handler and this turns red).
//   • error paths — an invalid body is rejected before any write, a missing id
//     param 400s, and a not-found surfaced by the query becomes a 404.
//
// It is runtime-free-ish: no Nuxt server, no DB, no network. The team-auth util
// and the generated queries module are `vi.mock`ed, the H3/Nitro auto-imports the
// handlers rely on are provided as globals via `vi.hoisted` (so the route's
// `export default defineEventHandler(...)` evaluates at import), and each handler
// is driven with a plain fake H3 event. The e2e fixture smoke still owns the real
// boot + CRUD; this is the unit-level complement.
//
// Opt-in via `--tests` (same gate as the schema-smoke; off by default, #2286). The
// assertions are engineered to be schema-shape-independent (mock/control-flow
// driven); the only body-shape-dependent case (invalid-body → rejected) is
// emitted only when an invalid sample is derivable, degrading gracefully.

import { toSnakeCase } from '../utils/helpers.ts'
import { buildCollectionSample, objectLiteral } from './collection-test.ts'

/** Mirror the API directory naming from generate-collection.ts (`${layer}-${plural}`,
 *  or the `crouton-<collection>` form for system layers). */
function apiPathFor(layer: string, plural: string, collection: string): string {
  if (layer.startsWith('crouton-')) {
    return toSnakeCase(`crouton_${collection}`).replace(/_/g, '-')
  }
  return `${layer}-${plural}`
}

/**
 * Generate the source of a `<Collection>.api.test.ts` handler test.
 * Returns the file content as a string (the orchestrator decides whether to
 * write it, honouring `--tests`).
 */
export function generateApiTest(data: Record<string, any>, config: Record<string, any> | null = null): string {
  const { layer, plural, singular, camelCase, pascalCase, pascalCasePlural, layerPascalCase, originalCollectionName } = data

  const S = `${layerPascalCase}${pascalCase}`        // ShopProduct      — singular query suffix
  const P = `${layerPascalCase}${pascalCasePlural}`  // ShopProducts     — plural query suffix
  const apiPath = apiPathFor(layer, plural, originalCollectionName || singular || plural)
  const idParam = `${camelCase}Id`                   // productId        — router param + filename
  const routeBase = `./server/api/teams/[id]/${apiPath}`

  const hierarchy = data.hierarchy?.enabled === true
  const sortable = !hierarchy && data.sortable?.enabled === true
  const hasReorder = hierarchy || sortable
  const orderField = hierarchy
    ? (data.hierarchy.orderField || 'order')
    : (sortable ? (data.sortable.orderField || 'order') : 'order')

  // --- mock factory: every query name the routes import must be present, else the
  // route gets `undefined` for it and throws on call. Extra exports are harmless.
  const queryExports = [
    `getAll${P}: vi.fn()`,
    `get${P}ByIds: vi.fn()`,
    `create${S}: vi.fn()`,
    `update${S}: vi.fn()`,
    `delete${S}: vi.fn()`,
  ]
  if (hierarchy) queryExports.push(`updatePosition${S}: vi.fn()`)
  if (hasReorder) queryExports.push(`reorderSiblings${P}: vi.fn()`)

  // Named imports we assert against.
  const queryImports = [`getAll${P}`, `create${S}`, `update${S}`, `delete${S}`]
  if (hierarchy) queryImports.push(`updatePosition${S}`)
  if (hasReorder) queryImports.push(`reorderSiblings${P}`)

  // Handler imports.
  const handlerImports = [
    `import getHandler from '${routeBase}/index.get.ts'`,
    `import postHandler from '${routeBase}/index.post.ts'`,
    `import patchHandler from '${routeBase}/[${idParam}].patch.ts'`,
    `import deleteHandler from '${routeBase}/[${idParam}].delete.ts'`,
  ]
  if (hierarchy) handlerImports.push(`import moveHandler from '${routeBase}/[${idParam}]/move.patch.ts'`)
  if (hasReorder) handlerImports.push(`import reorderHandler from '${routeBase}/reorder.patch.ts'`)

  // --- POST happy/invalid bodies, reusing the single-sourced sample derivation (#788).
  const { validEntries, requiredPlain } = buildCollectionSample(data, config)
  const validBodyLiteral = objectLiteral(validEntries, '  ')
  let invalidConst = ''
  let invalidPostCase = ''
  if (requiredPlain.length > 0) {
    const omit = requiredPlain[0].name
    const invalidEntries = validEntries.filter((e: string) => !e.startsWith(`${omit}:`))
    invalidConst = `\nconst INVALID_BODY = ${objectLiteral(invalidEntries, '  ')}`
    invalidPostCase = `

    it('rejects an invalid body before writing', async () => {
      // required \`${omit}\` omitted → readValidatedBody throws → no write happens
      await expect(postHandler({ __body: INVALID_BODY } as any)).rejects.toBeTruthy()
      expect(create${S}).not.toHaveBeenCalled()
    })`
  }

  // --- describe blocks
  const getBlock = `
  describe('index.get', () => {
    it('rejects an unauthenticated request', async () => {
      unauth()
      await expect(getHandler({ __query: {} } as any)).rejects.toBeTruthy()
      expect(getAll${P}).not.toHaveBeenCalled()
    })

    it('lists scoped to the resolved team', async () => {
      ;(getAll${P} as any).mockResolvedValue([])
      await getHandler({ __query: {} } as any)
      expect(getAll${P}).toHaveBeenCalled()
      // first positional arg is always the resolved team id (FK filters ride in opts)
      expect((getAll${P} as any).mock.calls[0][0]).toBe(TEAM.id)
    })
  })`

  const postBlock = `
  describe('index.post', () => {
    it('rejects an unauthenticated request and never writes', async () => {
      unauth()
      await expect(postHandler({ __body: VALID_BODY } as any)).rejects.toBeTruthy()
      expect(create${S}).not.toHaveBeenCalled()
    })

    it('creates scoped to the resolved team', async () => {
      ;(create${S} as any).mockResolvedValue({ id: 'rec_1' })
      const result = await postHandler({ __body: VALID_BODY } as any)
      expect(create${S}).toHaveBeenCalledWith(expect.objectContaining({ teamId: TEAM.id, owner: USER.id }))
      expect(result).toMatchObject({ id: 'rec_1' })
    })${invalidPostCase}
  })`

  const patchBlock = `
  describe('[${idParam}].patch', () => {
    it('400s when the id param is missing', async () => {
      await expect(patchHandler({ __params: {}, __body: {} } as any)).rejects.toMatchObject({ status: 400 })
    })

    it('rejects an unauthenticated request and never writes', async () => {
      unauth()
      await expect(patchHandler({ __params: { ${idParam}: 'rec_1' }, __body: {} } as any)).rejects.toBeTruthy()
      expect(update${S}).not.toHaveBeenCalled()
    })

    it('updates scoped to the resolved team', async () => {
      ;(update${S} as any).mockResolvedValue({ id: 'rec_1' })
      await patchHandler({ __params: { ${idParam}: 'rec_1' }, __body: {} } as any)
      expect(update${S}).toHaveBeenCalledWith('rec_1', TEAM.id, USER.id, expect.anything(), expect.anything())
    })

    it('propagates a not-found from the query as a 404', async () => {
      ;(update${S} as any).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
      await expect(patchHandler({ __params: { ${idParam}: 'missing' }, __body: {} } as any)).rejects.toMatchObject({ status: 404 })
    })
  })`

  const deleteBlock = `
  describe('[${idParam}].delete', () => {
    it('400s when the id param is missing', async () => {
      await expect(deleteHandler({ __params: {} } as any)).rejects.toMatchObject({ status: 400 })
    })

    it('rejects an unauthenticated request and never writes', async () => {
      unauth()
      await expect(deleteHandler({ __params: { ${idParam}: 'rec_1' } } as any)).rejects.toBeTruthy()
      expect(delete${S}).not.toHaveBeenCalled()
    })

    it('deletes scoped to the resolved team', async () => {
      ;(delete${S} as any).mockResolvedValue({ success: true })
      await deleteHandler({ __params: { ${idParam}: 'rec_1' } } as any)
      expect(delete${S}).toHaveBeenCalledWith('rec_1', TEAM.id, USER.id, expect.anything())
    })

    it('propagates a not-found from the query as a 404', async () => {
      ;(delete${S} as any).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
      await expect(deleteHandler({ __params: { ${idParam}: 'missing' } } as any)).rejects.toMatchObject({ status: 404 })
    })
  })`

  const moveBlock = hierarchy ? `
  describe('[${idParam}]/move.patch', () => {
    it('400s when the id param is missing', async () => {
      await expect(moveHandler({ __params: {}, __body: { order: 0 } } as any)).rejects.toMatchObject({ status: 400 })
    })

    it('rejects an unauthenticated request', async () => {
      unauth()
      await expect(moveHandler({ __params: { ${idParam}: 'rec_1' }, __body: { order: 0 } } as any)).rejects.toBeTruthy()
      expect(updatePosition${S}).not.toHaveBeenCalled()
    })

    it('400s on an invalid order', async () => {
      await expect(moveHandler({ __params: { ${idParam}: 'rec_1' }, __body: {} } as any)).rejects.toMatchObject({ status: 400 })
    })

    it('moves scoped to the resolved team', async () => {
      ;(updatePosition${S} as any).mockResolvedValue({ id: 'rec_1' })
      await moveHandler({ __params: { ${idParam}: 'rec_1' }, __body: { order: 0 } } as any)
      expect(updatePosition${S}).toHaveBeenCalledWith(TEAM.id, 'rec_1', null, 0)
    })
  })` : ''

  const reorderBlock = hasReorder ? `
  describe('reorder.patch', () => {
    it('rejects an unauthenticated request', async () => {
      unauth()
      await expect(reorderHandler({ __body: { updates: [] } } as any)).rejects.toBeTruthy()
      expect(reorderSiblings${P}).not.toHaveBeenCalled()
    })

    it('400s when updates is not an array', async () => {
      await expect(reorderHandler({ __body: {} } as any)).rejects.toMatchObject({ status: 400 })
    })

    it('reorders scoped to the resolved team', async () => {
      ;(reorderSiblings${P} as any).mockResolvedValue([])
      await reorderHandler({ __body: { updates: [{ id: 'a', ${orderField}: 0 }] } } as any)
      expect((reorderSiblings${P} as any).mock.calls[0][0]).toBe(TEAM.id)
    })
  })` : ''

  const blocks = [getBlock, postBlock, patchBlock, deleteBlock, moveBlock, reorderBlock].filter(Boolean).join('\n')

  const header = `// @ts-nocheck
/**
 * @crouton-generated
 * @collection ${plural}
 * @layer ${layer}
 *
 * API route handler test (#791): drives the generated endpoint handlers with a
 * mocked team-auth util + queries module and a fake H3 event. Covers what the
 * schema-smoke can't — team-scoping (unauthenticated → rejected; queries called
 * with the resolved team id) and error paths (invalid body → rejected, missing
 * id → 400, not-found → 404). Runtime-free: no Nuxt/DB, no network.
 * Regenerate with --force --tests.
 */
`

  return `${header}import { describe, it, expect, vi, beforeEach } from 'vitest'

// The generated handlers reference Nitro/H3 auto-imports as globals. Define them
// BEFORE the route modules import (vi.hoisted runs first) so that the route's
// \`export default defineEventHandler(...)\` evaluates. \`createError\` attaches its
// fields to the thrown Error so status codes stay assertable.
vi.hoisted(() => {
  const g = globalThis as any
  g.defineEventHandler = (fn: any) => fn
  g.useServerTiming = () => ({ start: () => ({ end: () => {} }) })
  g.getQuery = (event: any) => event?.__query ?? {}
  g.getRouterParams = (event: any) => event?.__params ?? {}
  g.readBody = async (event: any) => event?.__body
  g.readValidatedBody = async (event: any, validate: any) => validate(event?.__body)
  g.createError = (err: any) => Object.assign(new Error(err?.statusText || err?.message || 'error'), err)
})

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: vi.fn(),
}))
vi.mock('./server/database/queries', () => ({
  ${queryExports.join(',\n  ')},
}))

import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import {
  ${queryImports.join(',\n  ')},
} from './server/database/queries'
${handlerImports.join('\n')}

const TEAM = { id: 'team_1' }
const USER = { id: 'user_1' }
const MEMBERSHIP = { role: 'member' }
const VALID_BODY = ${validBodyLiteral}${invalidConst}

const authed = () => (resolveTeamAndCheckMembership as any).mockResolvedValue({ team: TEAM, user: USER, membership: MEMBERSHIP })
const unauth = () => (resolveTeamAndCheckMembership as any).mockRejectedValueOnce(Object.assign(new Error('Not a team member'), { status: 403 }))

beforeEach(() => {
  vi.clearAllMocks()
  authed()
})

describe('${layer}/${plural} API handlers (generated)', () => {
${blocks}
})
`
}
