// @vitest-environment node
/**
 * T7 (#4106) — the team-role helper maps crouton actions ↔ Better Auth's stored
 * permission both ways, and checks role names.
 */
import { describe, it, expect } from 'vitest'
import {
  TEAM_MANAGE_NATIVE,
  actionsToRolePermission,
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
