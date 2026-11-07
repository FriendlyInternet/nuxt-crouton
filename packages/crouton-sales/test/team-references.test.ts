import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { assertRefsInTeam } from '../../crouton-core/server/utils/teamRefs'

// #3404: the hand-owned sales POST/PATCH routes must reject references to another team's
// records before writing. assertRefsInTeam is the REAL crouton-core function, run against a real
// in-memory DB; only the create/update writers are mocked in the route-wiring tests.
const h = vi.hoisted(() => ({ create: null as any, update: null as any }))

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => ({ team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'member' } }),
}))
vi.mock('../collections/products/server/database/queries', async (orig) => ({
  ...(await orig() as object),
  createSalesProduct: (d: any) => h.create(d),
}))
vi.mock('../collections/printqueues/server/database/queries', async (orig) => ({
  ...(await orig() as object),
  updateSalesPrintqueue: (...a: any[]) => h.update(...a),
}))
vi.mock('../collections/categories/server/database/queries', async (orig) => ({
  ...(await orig() as object),
  updateSalesCategory: (...a: any[]) => h.update(...a),
}))
vi.mock('../server/utils/config-capture', () => ({ captureConfigWrite: async () => {} }))
vi.mock('../collections/products/server/utils/config-capture', () => ({ captureConfigWrite: async () => {} }))

const TABLES = ['events', 'categories', 'locations', 'clients', 'orders', 'products', 'printers']
const FIELD_TABLE: Record<string, string> = {
  eventId: 'events', categoryId: 'categories', locationId: 'locations', clientId: 'clients',
  orderId: 'orders', productId: 'products', printerId: 'printers',
}
// collection -> [function name suffix, refs]
const COLLECTIONS: Record<string, { fn: string, fields: string[], optional?: string[] }> = {
  categories: { fn: 'Category', fields: ['eventId'] },
  eventsettings: { fn: 'Eventsetting', fields: ['eventId'] },
  locations: { fn: 'Location', fields: ['eventId'] },
  products: { fn: 'Product', fields: ['eventId', 'categoryId', 'locationId'] },
  orders: { fn: 'Order', fields: ['eventId', 'clientId'], optional: ['clientId'] },
  orderitems: { fn: 'Orderitem', fields: ['orderId', 'productId'] },
  printers: { fn: 'Printer', fields: ['eventId', 'locationId'], optional: ['locationId'] },
  printqueues: { fn: 'Printqueue', fields: ['eventId', 'orderId', 'printerId', 'locationId'], optional: ['locationId'] },
  kdsbumps: { fn: 'Kdsbump', fields: ['eventId', 'orderId', 'locationId'] },
}

const g = globalThis as any
g.assertRefsInTeam = assertRefsInTeam
g.createError = (e: any) => Object.assign(new Error(e.statusText), e)
g.defineEventHandler = (fn: any) => fn
g.useServerTiming = () => ({ start: () => ({ end: () => {} }) })
g.getRouterParams = () => ({ categoryId: 'c1', printqueueId: 'pq1' })

let db: any
let selectSpy: any
let body: any
g.useDB = () => db
g.readValidatedBody = async (_e: any, parse: (b: unknown) => unknown) => parse(body)

const mine = (t: string) => `${t}-t1`
const theirs = (t: string) => `${t}-t2`

beforeAll(() => {
  const client = new Database(':memory:')
  for (const t of TABLES) {
    client.exec(`CREATE TABLE sales_${t} (id text primary key, teamId text not null)`)
    client.prepare(`insert into sales_${t} values (?, 't1'), (?, 't2')`).run(mine(t), theirs(t))
  }
  db = drizzle(client)
})

beforeEach(() => {
  h.create = vi.fn(async (d: any) => d)
  h.update = vi.fn(async () => ({}))
  selectSpy?.mockRestore()
  selectSpy = vi.spyOn(db, 'select')
})

const validData = (fields: string[]) => Object.fromEntries(fields.map(f => [f, mine(FIELD_TABLE[f])]))
const loadQueries = (c: string) => import(`../collections/${c}/server/database/queries.ts`)

const pairs = Object.entries(COLLECTIONS).flatMap(([c, { fn, fields }]) => fields.map(f => [c, fn, f, fields] as const))

describe('assertSales<X>References (real queries.ts, real assertRefsInTeam)', () => {
  it('has 19 collection/field pairs', () => expect(pairs).toHaveLength(19))

  it.each(Object.entries(COLLECTIONS))('%s: same-team references resolve', async (c, { fn, fields }) => {
    const q = await loadQueries(c)
    await expect(q[`assertSales${fn}References`]('t1', validData(fields))).resolves.toBeUndefined()
  })

  it.each(pairs)('%s: another team\'s %2$s-%3$s is rejected', async (c, fn, field, fields) => {
    const q = await loadQueries(c)
    const data = { ...validData(fields), [field]: theirs(FIELD_TABLE[field]) }
    await expect(q[`assertSales${fn}References`]('t1', data))
      .rejects.toMatchObject({ status: 400, statusText: `Invalid reference: ${field}` })
  })

  it('missing id → 400', async () => {
    const q = await loadQueries('products')
    await expect(q.assertSalesProductReferences('t1', { ...validData(COLLECTIONS.products.fields), eventId: 'does-not-exist' }))
      .rejects.toMatchObject({ status: 400, statusText: 'Invalid reference: eventId' })
  })

  it('null/omitted optional references are skipped', async () => {
    const printers = await loadQueries('printers')
    await expect(printers.assertSalesPrinterReferences('t1', { eventId: mine('events'), locationId: null })).resolves.toBeUndefined()
    const orders = await loadQueries('orders')
    await expect(orders.assertSalesOrderReferences('t1', { eventId: mine('events') })).resolves.toBeUndefined()
    const pq = await loadQueries('printqueues')
    await expect(pq.assertSalesPrintqueueReferences('t1', { eventId: mine('events'), orderId: mine('orders'), printerId: mine('printers') })).resolves.toBeUndefined()
  })
})

describe('sales routes check references before writing', () => {
  const route = async (c: string, file: string) =>
    (await import(`../collections/${c}/server/api/teams/[id]/sales-${c}/${file}`)).default

  it('POST sales-products with another team\'s categoryId → 400, nothing created', async () => {
    body = { ...validData(['eventId', 'locationId']), categoryId: theirs('categories'), title: 'Cola', price: 1 }
    await expect((await route('products', 'index.post.ts'))({})).rejects.toMatchObject({ status: 400, statusText: 'Invalid reference: categoryId' })
    expect(h.create).not.toHaveBeenCalled()
  })

  it('PATCH sales-printqueues with another team\'s printerId → 400, nothing updated', async () => {
    body = { printerId: theirs('printers') }
    await expect((await route('printqueues', '[printqueueId].patch.ts'))({})).rejects.toMatchObject({ status: 400, statusText: 'Invalid reference: printerId' })
    expect(h.update).not.toHaveBeenCalled()
  })

  it('PATCH sales-categories with only a title runs no reference query', async () => {
    body = { title: 'New' }
    await (await route('categories', '[categoryId].patch.ts'))({})
    expect(selectSpy).not.toHaveBeenCalled()
    expect(h.update).toHaveBeenCalledTimes(1)
  })
})
