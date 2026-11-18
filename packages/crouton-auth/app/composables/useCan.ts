/**
 * useCan — may the signed-in member do this in the current team? (#4104)
 *
 * Asks `GET /api/teams/[id]/can?actions=…` through `useRequestFetch()`, so the
 * session cookie is forwarded during server rendering too (the browser auth
 * client only exists client-side). Returns a computed boolean: true only when
 * every asked action is allowed. False while loading, on error, or with no team.
 *
 * @example
 * ```vue
 * <script setup>
 * const canEditPages = useCan('pages:edit')
 * </script>
 * <template>
 *   <UButton v-if="canEditPages" :label="t('pages.edit')" />
 * </template>
 * ```
 */
import type { ComputedRef } from 'vue'

export function useCan(action: string | string[]): ComputedRef<boolean> {
  const actions = [...new Set((Array.isArray(action) ? action : [action]).filter(Boolean))]
  const { teamId } = useTeamContext()
  const requestFetch = useRequestFetch()

  type Answer = { teamId: string | null, allowed: Record<string, boolean> }

  // A static key + `watch` (not a reactive key, which needs Nuxt ≥3.17) so a
  // team switch refetches on every Nuxt the package supports.
  const { data } = useAsyncData<Answer>(
    `crouton-can:${actions.join(',')}`,
    async () => {
      const id = teamId.value ?? null
      if (!id || actions.length === 0) return { teamId: id, allowed: {} }
      const allowed = await requestFetch<Record<string, boolean>>(`/api/teams/${id}/can`, {
        query: { actions: actions.join(',') }
      })
      return { teamId: id, allowed }
    },
    { watch: [teamId], default: () => ({ teamId: null, allowed: {} }) }
  )

  // Only trust an answer for the team we are in now: after a team switch the
  // previous team's answer stays in `data` until the new one arrives.
  return computed(() => {
    const answer = data.value
    if (!answer || !teamId.value || answer.teamId !== teamId.value) return false
    return actions.length > 0 && actions.every(a => answer.allowed[a] === true)
  })
}
