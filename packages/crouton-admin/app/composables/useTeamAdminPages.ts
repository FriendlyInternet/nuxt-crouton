/**
 * useTeamAdminPages — the team admin pages this member may open (#4220).
 *
 * One source for the admin side menu's Team section and the `team.vue` tabs.
 * Asks `useCan` once per distinct action in `TEAM_ADMIN_PAGES`; `useCan` reads
 * false while loading, so the list fills in once the answers arrive.
 *
 * Call it at setup, not inside a computed.
 */
import type { ComputedRef } from 'vue'
import { TEAM_ADMIN_ACTIONS, teamAdminPages, type TeamAdminPage } from '../utils/team-pages'

export function useTeamAdminPages(): ComputedRef<TeamAdminPage[]> {
  const { teamSlug, teamId } = useTeamContext()
  const answers: Record<string, ComputedRef<boolean>> = {}
  for (const action of TEAM_ADMIN_ACTIONS) answers[action] = useCan(action)

  return computed(() => teamAdminPages(
    teamSlug.value || teamId.value || '',
    action => answers[action]?.value === true
  ))
}
