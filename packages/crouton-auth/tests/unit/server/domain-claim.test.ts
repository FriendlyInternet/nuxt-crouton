/**
 * Domain claims: an unverified claim by team A must not block team B, a verified
 * one must, and a team can't add the same name twice. Runs the real POST handler
 * against an in-memory row list; only the DB/auth layer is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = { id: string, organizationId: string, domain: string, status: string, isPrimary?: boolean }
let rows: Row[] = []
let currentTeam = 'A'
const tbl = { domain: { domain: 'domain', status: 'status', organizationId: 'organizationId' } }

// Conditions are plain predicates so the stub honours eq/and like the real query.
vi.mock('../../../server/utils/team', () => ({ requireTeamOwner: async () => ({ team: { id: currentTeam } }) }))
vi.mock('../../../server/utils/database', () => ({
  tables: tbl,
  eq: (col: string, val: string) => (r: any) => r[col] === val,
  and: (...ps: any[]) => (r: any) => ps.every(p => p(r)),
  generateVerificationToken: () => 'tok',
  useDB: () => ({
    select: () => ({
      from: () => {
        let pred = (_: Row) => true
        const q: any = {
          where: (p: any) => { pred = p; return q },
          get: async () => rows.find(pred),
          then: (res: any) => res(rows.filter(pred))
        }
        return q
      }
    }),
    insert: () => ({
      values: (v: any) => ({
        returning: async () => {
          if (rows.some(r => r.organizationId === v.organizationId && r.domain === v.domain)) throw new Error('UNIQUE')
          const row = { id: String(rows.length + 1), ...v }
          rows.push(row)
          return [row]
        }
      })
    })
  })
}))

vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('readValidatedBody', async (_e: any, parse: any) => parse((globalThis as any).__body))
vi.stubGlobal('setResponseStatus', () => {})
vi.stubGlobal('createError', (o: any) => Object.assign(new Error(o.statusText), o))

const add = async (team: string, domain: string) => {
  currentTeam = team
  ;(globalThis as any).__body = { domain }
  const handler = (await import('../../../server/api/teams/[id]/domains/index.post')).default as any
  return handler({})
}

describe('POST /domains claim rules', () => {
  beforeEach(() => { rows = [] })

  it('a pending claim by team A does not block team B', async () => {
    await add('A', 'shop.example.com')
    await expect(add('B', 'shop.example.com')).resolves.toMatchObject({ organizationId: 'B' })
  })

  it('a verified domain still refuses another team', async () => {
    rows.push({ id: 'x', organizationId: 'A', domain: 'shop.example.com', status: 'verified' })
    await expect(add('B', 'shop.example.com')).rejects.toMatchObject({ status: 400 })
  })

  it('a team cannot add its own domain twice', async () => {
    await add('A', 'shop.example.com')
    await expect(add('A', 'shop.example.com')).rejects.toMatchObject({ status: 400 })
  })
})
