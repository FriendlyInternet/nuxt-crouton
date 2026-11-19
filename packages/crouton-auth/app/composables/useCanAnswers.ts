/**
 * Every answer any `useCan` on the page has received, keyed by the team id it
 * asked for, then action (#4105). `useTeam()` reads `team:manage` from here so
 * its legacy flags follow the real answer without calling `useCan` (which would
 * loop: useCan → useTeamContext → useTeam).
 *
 * Its own file so `useTeam.ts` can import it without importing `useCan.ts`,
 * which would make an import cycle (useCan → useTeamContext → useTeam → useCan).
 */
import type { Ref } from 'vue'

export function useCanAnswers(): Ref<Record<string, Record<string, boolean>>> {
  return useState<Record<string, Record<string, boolean>>>('crouton-can-answers', () => ({}))
}
