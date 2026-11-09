/**
 * The reference fields a generated POST/PATCH must verify belong to the caller's team (#3378).
 *
 * Shared by `database-queries.ts` (emits `assert<X>References`) and `api-endpoints.ts` /
 * `api-test.ts` (call / mock it), so they cannot disagree on which fields are checked.
 *
 * External references (`refScope: external|adapter`, e.g. users) are skipped: their tables have
 * no `teamId`. Auto user refs (owner/createdBy/updatedBy) are set by the server, not the body.
 */
export function collectTeamRefFields(data: Record<string, any>): Array<Record<string, any>> {
  return (data.fields || []).filter((f: Record<string, any>) =>
    f.refTarget && f.refScope !== 'external' && f.refScope !== 'adapter',
  )
}
