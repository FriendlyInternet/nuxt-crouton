// @vitest-environment node
/**
 * T7 (#4106) — the team-role helper maps crouton actions ↔ Better Auth's stored
 * permission both ways, and checks role names.
 */
import { describe, it, expect } from 'vitest'
import {
  ADMIN_FIXED_NATIVE,
  TEAM_MANAGE_NATIVE,
  actionsToRolePermission,
  adminActionsToRolePermission,
  isBaseRole,
  roleEditState,
  rolePermissionToActions,
  validateRoleName
} from '../../../shared/utils/team-roles'

const REGISTERED = ['admin:access', 'team:manage', 'team:domains', 'pages:edit', 'site:manage']

describe('team roles helper (T7)', () => {
  it('stores a plain action as { resource: [verb] }', () => {
    expect(actionsToRolePermission(['pages:edit'])).toEqual({ pages: ['edit'] })
  })

  it('team:manage also brings Better Auth\'s member / invitation / ac rights; removing it removes them', () => {
    const withManage = actionsToRolePermission(['team:manage', 'pages:edit'])
    expect(withManage.team).toEqual(['manage'])
    for (const [resource, verbs] of Object.entries(TEAM_MANAGE_NATIVE)) {
      expect(withManage[resource]).toEqual([...verbs])
    }
    const without = actionsToRolePermission(['pages:edit'])
    expect(without.member).toBeUndefined()
    expect(without.invitation).toBeUndefined()
    expect(without.ac).toBeUndefined()
  })

  it('never stores admin:access (it comes with any other action)', () => {
    expect(actionsToRolePermission(['admin:access'])).toEqual({})
    expect(actionsToRolePermission(['admin:access', 'pages:edit'])).toEqual({ pages: ['edit'] })
  })

  it('reads back only registered crouton actions, never Better Auth\'s own entries', () => {
    const stored = actionsToRolePermission(['team:manage', 'pages:edit'])
    expect(rolePermissionToActions(stored, REGISTERED)).toEqual(['team:manage', 'pages:edit'])
    // native team:update is not team:manage; member/ac entries never show
    expect(rolePermissionToActions({ team: ['update'], member: ['update'], ac: ['read'] }, REGISTERED)).toEqual([])
    // a stored admin:access is never listed
    expect(rolePermissionToActions({ admin: ['access'], pages: ['edit'] }, REGISTERED)).toEqual(['pages:edit'])
    // the JSON string form Better Auth keeps in the table
    expect(rolePermissionToActions('{"pages":["edit"]}', REGISTERED)).toEqual(['pages:edit'])
    expect(rolePermissionToActions('not json', REGISTERED)).toEqual([])
  })

  it('validateRoleName refuses empty, comma, too long and base names', () => {
    expect(validateRoleName('')).toBe('empty')
    expect(validateRoleName('   ')).toBe('empty')
    expect(validateRoleName('a,b')).toBe('comma')
    expect(validateRoleName('x'.repeat(41))).toBe('tooLong')
    expect(validateRoleName('owner')).toBe('base')
    expect(validateRoleName(' Admin ')).toBe('base')
    expect(validateRoleName('éditeur')).toBeNull()
    expect(isBaseRole('member')).toBe(true)
    expect(isBaseRole('éditeur')).toBe(false)
  })

  it('roleEditState locks actions the editor lacks and makes a role holding one read-only', () => {
    const grantable = { 'team:manage': true, 'pages:edit': false, 'site:manage': true }
    expect(roleEditState(['site:manage'], grantable)).toEqual({ lockedActions: ['pages:edit'], readOnly: false })
    expect(roleEditState(['pages:edit'], grantable)).toEqual({ lockedActions: ['pages:edit'], readOnly: true })
    expect(roleEditState(['pages:edit'], { 'pages:edit': true })).toEqual({ lockedActions: [], readOnly: false })
  })
})

describe('the admin row\'s permission (#4130)', () => {
  // covers: T7
  it('always keeps organization:update and the sub-team rights; team:manage adds and removes only member / invitation / ac', () => {
    const without = adminActionsToRolePermission(['pages:edit'])
    expect(without).toEqual({ pages: ['edit'], organization: ['update'], team: ['create', 'update', 'delete'] })
    expect(without.member).toBeUndefined()
    expect(without.invitation).toBeUndefined()
    expect(without.ac).toBeUndefined()

    const withManage = adminActionsToRolePermission(['pages:edit', 'team:manage'])
    for (const [resource, verbs] of Object.entries({ ...TEAM_MANAGE_NATIVE, ...ADMIN_FIXED_NATIVE })) {
      for (const verb of verbs) expect(withManage[resource]).toContain(verb)
    }
    expect(withManage.team).toEqual(['manage', 'create', 'update', 'delete'])
    // Read back, the screen sees only the crouton actions.
    expect(rolePermissionToActions(withManage, REGISTERED)).toEqual(['team:manage', 'pages:edit'])
  })
})
