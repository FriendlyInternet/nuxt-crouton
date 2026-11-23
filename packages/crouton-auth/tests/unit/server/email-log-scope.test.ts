// @vitest-environment node
/**
 * Team email log scoping (#3546) — against a real in-memory SQLite.
 *
 * Rule: a team admin sees exactly the emails that belong to their team.
 * - rows with organizationId = this team → included (even if the recipient isn't a member)
 * - rows with another team's organizationId → excluded
 * - rows with no organizationId → included only when the recipient is a current member
 *
 * Also covers the write side: the logger stores the invitation's team.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { count } from 'drizzle-orm'
import * as authSchema from '../../../server/database/schema/auth'
import { teamEmailLogScope } from '../../../server/utils/email-log-scope'

// Only the columns these queries touch; auth_email_log mirrors the full schema.
const SQL = [
  'CREATE TABLE `user` (`id` text PRIMARY KEY NOT NULL, `email` text NOT NULL);',
  'CREATE TABLE `member` (`id` text PRIMARY KEY NOT NULL, `organizationId` text NOT NULL, `userId` text NOT NULL);',
  'CREATE TABLE `auth_email_log` (`id` text PRIMARY KEY NOT NULL, `organizationId` text, `emailType` text NOT NULL, `recipientEmail` text NOT NULL, `status` text DEFAULT \'pending\' NOT NULL, `error` text, `sentAt` integer, `metadata` text, `providerId` text, `createdAt` integer NOT NULL);'
]

const A = 'team-a'
const B = 'team-b'
const SHARED = 'shared@example.com' // member of A and B
const ONLY_A = 'only-a@example.com' // member of A only
const NEWBIE = 'newbie@example.com' // member of nobody yet

let sqlite: Database.Database
let db: ReturnType<typeof drizzle>

function log(id: string, recipientEmail: string, emailType: string, organizationId: string | null) {
  sqlite.prepare('insert into auth_email_log (id, organizationId, emailType, recipientEmail, createdAt) values (?, ?, ?, ?, ?)')
    .run(id, organizationId, emailType, recipientEmail, Date.now())
}

const visible = (team: string) =>
  db.select({ id: authSchema.authEmailLog.id }).from(authSchema.authEmailLog)
    .where(teamEmailLogScope(db, team)).all().map(r => r.id).sort()

const total = (team: string) =>
  db.select({ total: count() }).from(authSchema.authEmailLog).where(teamEmailLogScope(db, team)).get()!.total

beforeEach(() => {
  sqlite = new Database(':memory:')
  for (const s of SQL) sqlite.exec(s)
  db = drizzle(sqlite, { schema: authSchema })
  const users = [['u-shared', SHARED], ['u-a', ONLY_A], ['u-new', NEWBIE]]
  for (const [id, email] of users) sqlite.prepare('insert into user (id, email) values (?, ?)').run(id, email)
  const members = [['m1', A, 'u-shared'], ['m2', B, 'u-shared'], ['m3', A, 'u-a']]
  for (const [id, org, uid] of members) sqlite.prepare('insert into member (id, organizationId, userId) values (?, ?, ?)').run(id, org, uid)
})

describe('teamEmailLogScope (#3546)', () => {
  it('an invitation from B to someone who has not joined shows in B, not in A', () => {
    log('b-invites-newbie', NEWBIE, 'invitation', B)
    expect(visible(B)).toEqual(['b-invites-newbie'])
    expect(visible(A)).toEqual([])
  })

  it('an invitation from B to a member of both teams shows in B only', () => {
    log('b-invites-shared', SHARED, 'invitation', B)
    log('b-resends-shared', SHARED, 'invitation', B)
    expect(visible(B)).toEqual(['b-invites-shared', 'b-resends-shared'])
    expect(visible(A)).toEqual([])
    expect(total(A)).toBe(0)
    expect(total(B)).toBe(2)
  })

  it('a team-less email (password reset) to the shared member shows for both teams', () => {
    log('reset-shared', SHARED, 'password-reset', null)
    expect(visible(A)).toEqual(['reset-shared'])
    expect(visible(B)).toEqual(['reset-shared'])
  })

  it('a team-less email to a non-member shows for nobody', () => {
    log('verify-newbie', NEWBIE, 'verification', null)
    expect(visible(A)).toEqual([])
    expect(visible(B)).toEqual([])
  })

  it('old invitation rows (no team recorded) keep today\'s behaviour: shown to the recipient\'s teams', () => {
    log('old-invite-only-a', ONLY_A, 'invitation', null)
    expect(visible(A)).toEqual(['old-invite-only-a'])
    expect(visible(B)).toEqual([])
  })

  it('a team with no members still sees its own invitations', () => {
    log('c-invites-newbie', NEWBIE, 'invitation', 'team-c')
    expect(visible('team-c')).toEqual(['c-invites-newbie'])
  })
})

describe('auth email logger stores the team (#3546)', () => {
  it('writes organizationId for an invitation, null for a team-less email', async () => {
    const handlers: Record<string, (p: any) => Promise<void>> = {}
    vi.stubGlobal('defineNitroPlugin', (fn: any) => fn)
    vi.stubGlobal('useDB', () => db)
    vi.doMock('../../../server/utils/database', () => ({ useDB: () => db, tables: authSchema }))
    const plugin = (await import('../../../server/plugins/auth-email-logger')).default as any
    plugin({ hooks: { hook: (name: string, fn: any) => { handlers[name] = fn } } })

    await handlers['crouton:auth:email']!({ type: 'invitation', to: NEWBIE, organizationId: B, invitationId: 'i1', organizationName: 'B', inviterName: 'x', inviterEmail: SHARED, role: 'member', expiresAt: new Date() })
    await handlers['crouton:auth:email']!({ type: 'password-reset', to: SHARED, url: 'https://x' })

    const rows = sqlite.prepare('select emailType, organizationId from auth_email_log order by emailType').all()
    expect(rows).toEqual([
      { emailType: 'invitation', organizationId: B },
      { emailType: 'password-reset', organizationId: null }
    ])
    vi.unstubAllGlobals()
  })
})
