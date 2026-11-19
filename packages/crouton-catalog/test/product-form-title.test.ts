import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { catalogProductsConfig } from '../collections/products/app/composables/useCatalogProducts'
import { applyDefaultLocaleProductFields } from '../collections/products/app/utils/applyDefaultLocaleProductFields'

// The form starts from the config's default values (title: ''), which the server
// rejects. The form copies the default language's title into `title` on the
// translation input's update:english event — this checks the two fit together.
const hoisted = vi.hoisted(() => ({
  member: { team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'admin' } },
  create: vi.fn(async (d: any) => d)
}))

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => hoisted.member,
  requireTeamAdmin: async () => hoisted.member
}))
vi.mock('../collections/products/server/database/queries', () => ({ createCatalogProduct: hoisted.create, updateCatalogProduct: vi.fn(), getCatalogProductsByIds: vi.fn() }))

let body: unknown

beforeEach(() => {
  hoisted.create.mockClear()
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('readValidatedBody', async (_e: any, parse: (b: unknown) => unknown) => parse(body))
})
afterEach(() => vi.unstubAllGlobals())

const run = async () => (await import('../collections/products/server/api/teams/[id]/catalog-products/index.post')).default({})

describe('product form → POST title', () => {
  it('the form\'s default values are rejected (empty title)', async () => {
    body = { ...catalogProductsConfig.defaultValues }
    await expect(run()).rejects.toThrow()
    expect(hoisted.create).not.toHaveBeenCalled()
  })

  it('after the English title is copied in, the product is created with it', async () => {
    const state: Record<string, any> = { ...catalogProductsConfig.defaultValues, translations: { en: { title: 'Court' } } }
    applyDefaultLocaleProductFields(state, { field: 'title', value: 'Court' })
    body = state
    await run()
    expect(hoisted.create).toHaveBeenCalledTimes(1)
    expect(hoisted.create.mock.calls[0]![0].title).toBe('Court')
  })

  it('after a French-only title and description are copied in, the product is created with them (#4236)', async () => {
    const state: Record<string, any> = { ...catalogProductsConfig.defaultValues, translations: { fr: { title: 'Vélo', description: 'Un vélo cargo' } } }
    applyDefaultLocaleProductFields(state, { field: 'title', value: 'Vélo' })
    applyDefaultLocaleProductFields(state, { field: 'description', value: 'Un vélo cargo' })
    body = state
    await run()
    expect(hoisted.create.mock.calls[0]![0]).toMatchObject({ title: 'Vélo', description: 'Un vélo cargo' })
  })

  it('an update to another field leaves the title alone', () => {
    const state: Record<string, any> = { title: 'Court' }
    applyDefaultLocaleProductFields(state, { field: 'active', value: 'x' })
    expect(state.title).toBe('Court')
  })

  it('the description is copied into the main column (#4236)', () => {
    const state: Record<string, any> = { title: 'Court', description: '' }
    applyDefaultLocaleProductFields(state, { field: 'description', value: 'x' })
    expect(state).toEqual({ title: 'Court', description: 'x' })
  })
})
