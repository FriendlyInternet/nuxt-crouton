/**
 * What a PUBLIC collection endpoint may hand out of a row the admin queries produced.
 *
 * The registry's `getAll`/`getByIds` are the team-scoped admin functions: they join the auth
 * user table (`ownerUser`, `createdByUser`, `updatedByUser` → `{ id, name, email, image }`) and
 * hydrate FK targets (`categoryIdData`, `eventIdData` …), which carry their own user joins.
 * The public endpoints serve anonymous, cached responses, so none of that may leave: strip the
 * audit columns and every joined user object, recursively through hydrated rows and arrays.
 * (A collection-specific sensitive field is handled upstream: a package only registers the
 * collections that make sense on a public page — see each package's server/query-registry.ts.)
 */
const INTERNAL_KEYS = new Set(['createdBy', 'updatedBy', 'owner', 'userId'])
/** Backstop for a secret-shaped column that slipped onto a public collection (`helperPin`, `apiKey` …). */
const SECRET_KEY = /(pin|secret|token|password|hash|apikey)$/i

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip)
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    if (INTERNAL_KEYS.has(key) || key.endsWith('User') || SECRET_KEY.test(key)) continue
    out[key] = strip(v)
  }
  return out
}

export function stripInternalFields(item: Record<string, unknown>): Record<string, unknown> {
  return strip(item) as Record<string, unknown>
}
