#!/usr/bin/env node
// Throwaway check for writeups/architecture/team-admin-role-override.md (#4116).
// NOT product code. Runs the real installed better-auth@1.7.7 (the copy
// packages/crouton-auth resolves) on an in-memory database and answers:
//
//   A. With admin defined in code (today's plan, #4104): can a team store a
//      role row named "admin"? Can a stored row take permissions away?
//   C. With admin NOT in code and seeded as a per-team row instead: can the
//      owner change what admin may do in team A without touching team B, and
//      do Better Auth's own endpoints (invite, change role) follow?
//
// Run:  node writeups/architecture/team-admin-role-override.check.mjs
// Exit 0 = every expectation held; exit 1 = one did not (printed).

const BA = new URL('../../packages/crouton-auth/node_modules/better-auth/dist/', import.meta.url)
const { betterAuth } = await import(new URL('index.mjs', BA))
const { organization } = await import(new URL('plugins/index.mjs', BA))
const { memoryAdapter } = await import(new URL('adapters/memory-adapter/index.mjs', BA))
const { createAccessControl } = await import(new URL('plugins/access/index.mjs', BA))
const { defaultStatements, ownerAc, adminAc, memberAc } = await import(new URL('plugins/organization/access/index.mjs', BA))

// Crouton actions as one extra resource (the exact shape is #4104's call).
const croutonActions = ['team:manage', 'team:domains', 'pages:edit']
const ac = createAccessControl({ ...defaultStatements, crouton: croutonActions })
const ownerRole = ac.newRole({ ...ownerAc.statements, crouton: croutonActions })
const adminStatements = { ...adminAc.statements, crouton: croutonActions }
const adminRole = ac.newRole(adminStatements)
const memberRole = ac.newRole({ ...memberAc.statements, crouton: [] })

let failures = 0
function expect(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

async function makeWorld(roles, hooks) {
  const db = { user: [], session: [], account: [], verification: [], organization: [], member: [], invitation: [], organizationRole: [] }
  const auth = betterAuth({
    secret: 'throwaway-check-secret-0123456789abcdef',
    baseURL: 'http://localhost:3000',
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    plugins: [organization({ ac, roles, creatorRole: 'owner', dynamicAccessControl: { enabled: true }, organizationHooks: hooks })],
  })
  async function user(name) {
    const email = `${name}@example.test`
    await auth.api.signUpEmail({ body: { email, password: 'password-1234', name } })
    const { headers } = await auth.api.signInEmail({ body: { email, password: 'password-1234' }, returnHeaders: true })
    const cookie = headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    const h = new Headers({ cookie })
    const session = await auth.api.getSession({ headers: h })
    return { id: session.user.id, headers: h }
  }
  async function call(fn) {
    try { return { ok: true, data: await fn() } }
    catch (e) { return { ok: false, code: e?.body?.code ?? e?.message } }
  }
  async function can(u, orgId, permissions) {
    const r = await call(() => auth.api.hasPermission({ headers: u.headers, body: { organizationId: orgId, permissions } }))
    return r.ok ? r.data.success : r.code
  }
  return { auth, db, user, call, can }
}

// ─── A. admin defined in code (today's #4104 plan) ─────────────────────────
console.log('\n── A: admin defined in code ──')
{
  const w = await makeWorld({ owner: ownerRole, admin: adminRole, member: memberRole })
  const owner = await w.user('ownerA')
  const admin = await w.user('adminA')
  const org = await w.auth.api.createOrganization({ headers: owner.headers, body: { name: 'Team A', slug: 'team-a' } })
  await w.auth.api.addMember({ body: { userId: admin.id, role: 'admin', organizationId: org.id } })

  const r = await w.call(() => w.auth.api.createOrgRole({ headers: owner.headers, body: { organizationId: org.id, role: 'admin', permission: { crouton: ['pages:edit'] } } }))
  expect('A1 owner creates a team role named "admin"', r.ok ? 'created' : r.code, 'ROLE_NAME_IS_ALREADY_TAKEN')

  // Even if a row named admin got in (bypassing the endpoint), it only ADDS.
  w.db.organizationRole.push({ id: 'r1', organizationId: org.id, role: 'admin', permission: JSON.stringify({ crouton: [] }), createdAt: new Date() })
  expect('A2 a stored "admin" row with no domains still leaves admin with team:domains', await w.can(admin, org.id, { crouton: ['team:domains'] }), true)
}

// ─── C. admin seeded as a per-team row, not in code ───────────────────────
console.log('\n── C: admin seeded per team, editable ──')
{
  let world
  const hooks = {
    // Seed the editable admin row for every new team (product version: same hook).
    afterCreateOrganization: async ({ organization: o }) => {
      await (await world.auth.$context).adapter.create({
        model: 'organizationRole',
        data: { organizationId: o.id, role: 'admin', permission: JSON.stringify(adminStatements), createdAt: new Date() },
      })
    },
  }
  const w = world = await makeWorld({ owner: ownerRole, member: memberRole }, hooks)
  const ownerA = await w.user('ownerA'); const adminA = await w.user('adminA')
  const ownerB = await w.user('ownerB'); const adminB = await w.user('adminB')
  const invitee = await w.user('memberA')
  const A = await w.auth.api.createOrganization({ headers: ownerA.headers, body: { name: 'Team A', slug: 'team-a' } })
  const B = await w.auth.api.createOrganization({ headers: ownerB.headers, body: { name: 'Team B', slug: 'team-b' } })
  await w.auth.api.addMember({ body: { userId: adminA.id, role: 'admin', organizationId: A.id } })
  await w.auth.api.addMember({ body: { userId: adminB.id, role: 'admin', organizationId: B.id } })
  await w.auth.api.addMember({ body: { userId: invitee.id, role: 'member', organizationId: A.id } })
  const inviteeMember = w.db.member.find(m => m.userId === invitee.id)

  expect('C0 seed hook made one admin row per team', w.db.organizationRole.filter(r => r.role === 'admin').length, 2)
  expect('C1 before: admin in A has team:domains', await w.can(adminA, A.id, { crouton: ['team:domains'] }), true)

  // Owner of A takes domains away from admin in A only.
  const { crouton: _c, ...baStatements } = adminStatements
  const noDomains = { ...baStatements, crouton: ['team:manage', 'pages:edit'] }
  const upd = await w.call(() => w.auth.api.updateOrgRole({ headers: ownerA.headers, body: { organizationId: A.id, roleName: 'admin', data: { permission: noDomains } } }))
  expect('C2 owner of A edits the admin role of A', upd.ok, true)
  expect('C3 after: admin in A lost team:domains', await w.can(adminA, A.id, { crouton: ['team:domains'] }), false)
  expect('C4 after: admin in A keeps pages:edit', await w.can(adminA, A.id, { crouton: ['pages:edit'] }), true)
  expect('C5 after: admin in B still has team:domains', await w.can(adminB, B.id, { crouton: ['team:domains'] }), true)
  expect('C6 owner in A still has team:domains (owner is in code)', await w.can(ownerA, A.id, { crouton: ['team:domains'] }), true)

  // Admin cannot give themselves back what they lost (Better Auth refuses granting what you don't hold).
  const selfGrant = await w.call(() => w.auth.api.updateOrgRole({ headers: adminA.headers, body: { organizationId: A.id, roleName: 'admin', data: { permission: adminStatements } } }))
  expect('C7 admin of A re-adds team:domains to admin', selfGrant.ok ? 'updated' : selfGrant.code, 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_A_ROLE')

  // …but Better Auth does NOT stop an admin from editing the admin role downwards.
  const selfShrink = await w.call(() => w.auth.api.updateOrgRole({ headers: adminA.headers, body: { organizationId: A.id, roleName: 'admin', data: { permission: { ...noDomains, crouton: ['team:manage'] } } } }))
  expect('C8 admin of A can still shrink the admin role (crouton must guard "owner only")', selfShrink.ok, true)
  await w.auth.api.updateOrgRole({ headers: ownerA.headers, body: { organizationId: A.id, roleName: 'admin', data: { permission: noDomains } } })

  // Better Auth's own endpoints follow the stored row.
  const changeRole = await w.call(() => w.auth.api.updateMemberRole({ headers: adminA.headers, body: { organizationId: A.id, memberId: inviteeMember.id, role: 'member' } }))
  expect('C9 admin of A (with member:update stored) can still change a member role', changeRole.ok, true)
  const noManage = { organization: ['update'], ac: ['read'], crouton: ['pages:edit'] }
  await w.auth.api.updateOrgRole({ headers: ownerA.headers, body: { organizationId: A.id, roleName: 'admin', data: { permission: noManage } } })
  const invite = await w.call(() => w.auth.api.createInvitation({ headers: adminA.headers, body: { organizationId: A.id, email: 'new@example.test', role: 'member' } }))
  expect('C10 after owner removes team:manage (and BA member/invitation perms): admin of A cannot invite', invite.ok ? 'invited' : invite.code, 'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION')
  const invB = await w.call(() => w.auth.api.createInvitation({ headers: adminB.headers, body: { organizationId: B.id, email: 'new@example.test', role: 'member' } }))
  expect('C11 admin of B can still invite', invB.ok, true)

  // Lock-out shape: the admin row can be deleted while nobody holds it, and
  // "admin" stays assignable (Better Auth always accepts its default names).
  await w.auth.api.updateMemberRole({ headers: ownerA.headers, body: { organizationId: A.id, memberId: w.db.member.find(m => m.userId === adminA.id).id, role: 'member' } })
  const del = await w.call(() => w.auth.api.deleteOrgRole({ headers: ownerA.headers, body: { organizationId: A.id, roleName: 'admin' } }))
  expect('C12 owner can delete the admin row once no member holds it (crouton must refuse)', del.ok, true)
  const reassign = await w.call(() => w.auth.api.updateMemberRole({ headers: ownerA.headers, body: { organizationId: A.id, memberId: w.db.member.find(m => m.userId === adminA.id).id, role: 'admin' } }))
  expect('C13 "admin" is still assignable with no row', reassign.ok, true)
  expect('C14 …and then that admin has nothing (fails closed, not open)', await w.can(adminA, A.id, { crouton: ['pages:edit'] }), false)
  expect('C15 owner of A is never affected', await w.can(ownerA, A.id, { crouton: ['team:manage'], member: ['update'] }), true)
}

console.log(failures ? `\n${failures} expectation(s) failed` : '\nall expectations held')
process.exit(failures ? 1 : 0)
