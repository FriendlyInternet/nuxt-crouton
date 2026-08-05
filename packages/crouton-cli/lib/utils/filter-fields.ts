/**
 * The reference fields a generated list endpoint can be scoped by (`?assigneeId=…`).
 *
 * WHY THIS IS SHARED. Two generators emit the two halves of one contract:
 * `api-endpoints.ts` reads the query params, `database-queries.ts` declares the `opts` they are
 * passed as. They used to derive the list independently — from `data.fields` and from
 * `singleReferences` respectively — and agreed only by coincidence. A change to either side
 * silently produced an endpoint passing an option the query function didn't accept. One source,
 * so they cannot drift.
 *
 * WHY THE USER REFS ARE IN. `owner`/`createdBy`/`updatedBy` were previously excluded as "not
 * real FK columns". They are real columns, and "everything I own" / "what did I change" are
 * ordinary things to ask a list for. The exclusion also caught any field the AUTHOR declared as
 * a person reference (`refScope: "external"`), so declaring an `assigneeId` silently cost you
 * the ability to filter by it — the flag conflated "crouton added this" with "you asked for
 * this". Both are filterable now.
 */
export function collectFilterFields(
  data: Record<string, any>,
  config: Record<string, any> | null = null,
): string[] {
  const declared = (data.fields || [])
    .filter((f: Record<string, any>) => f.refTarget)
    .map((f: Record<string, any>) => f.name as string)

  // Mirrors the auto refs `detectReferenceFields` appends: owner is unconditional, the audit
  // pair rides `useMetadata`. Order matches so the emitted opts read the same in both files.
  const useMetadata = config?.flags?.useMetadata ?? true
  const auto = useMetadata ? ['owner', 'createdBy', 'updatedBy'] : ['owner']

  return [...declared, ...auto]
}
