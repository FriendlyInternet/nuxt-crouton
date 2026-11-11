/**
 * Which page visibilities a caller may read. An explicit `?visibility=` query
 * only NARROWS this set — it can never widen it (anonymous `?visibility=admin`
 * must not return admin pages).
 */
export function allowedVisibilities(access: {
  isAdmin: boolean
  isMember: boolean
  hasScopedAccess: boolean
}): string[] {
  if (access.isAdmin) return ['public', 'members', 'admin', 'scoped']
  if (access.isMember) return ['public', 'members', 'scoped']
  if (access.hasScopedAccess) return ['public', 'scoped']
  return ['public']
}

export function resolveVisibilities(allowed: string[], requested?: string): string[] {
  if (!requested) return allowed
  return allowed.includes(requested) ? [requested] : []
}
