/**
 * Verify endpoint: first verified claim wins. Runs the real handler; only the
 * DB/auth layer and the DNS lookup are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = { id: string, organizationId: string, domain: string, status: string, verificationToken: string }
let rows: Row[] = []
const tbl = { domain: { id: 'id', domain: 'domain', status: 'status', organizationId: 'organizationId' } }

vi.mock('../../../server/utils/team', () => ({ requireTeamOwner: async () => ({ team: { id: 'B' } }) }))
vi.mock('../../../server/utils/database', () => ({
  tables: tbl,
  eq: (col: string, val: string) => (r: any) => r[col] === val,
  and: (...ps: any[]) => (r: any) => ps.every(p => p(r)),
  useDB: () => ({
    select: () => ({
      from: () => {
        let pred = (_: Row) => true
        const q: any = { where: (p: any) => { pred = p; return q }, get: async () => rows.find(pred) }
        return q
      }
    }),
    update: () => ({
      set: (v: any) => ({
        where: async (p: any) => { rows.filter(p).forEach(r => Object.assign(r, v)) }
      })
    })
  })
}))

vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('getRouterParam', () => 'b1')
vi.stubGlobal('createError', (o: any) => Object.assign(new Error(o.statusText), o))
vi.stubGlobal('$fetch', async () => ({ Status: 0, Answer: [{ data: '"tok"' }] }))

const verify = async () => ((await import('../../../server/api/teams/[id]/domains/[domainId]/verify.post')).default as any)({})

describe('POST /domains/[id]/verify', () => {
  beforeEach(() => {
    rows = [{ id: 'b1', organizationId: 'B', domain: 'shop.example.com', status: 'pending', verificationToken: 'tok' }]
  })

  it('refuses when another team already verified the domain', async () => {
    rows.push({ id: 'a1', organizationId: 'A', domain: 'shop.example.com', status: 'verified', verificationToken: 'x' })
    await expect(verify()).resolves.toMatchObject({ verified: false })
    expect(rows[0].status).toBe('pending')
  })

  it('verifies when nobody else holds it', async () => {
    await expect(verify()).resolves.toMatchObject({ verified: true })
    expect(rows[0].status).toBe('verified')
  })
})
