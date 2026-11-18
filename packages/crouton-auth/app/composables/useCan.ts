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
 *
 * On a shared-cached public page (the public page route is `swr`), pass
 * `{ server: false }` so the answer is only ever fetched in the browser and
 * never baked into the cached HTML/payload for the next visitor (#4105).
 *
 * Do NOT use this inside route middleware: it reads `false` while loading, so a
 * guard would refuse everyone on the first pass. Use the `can` middleware.
 */
import type { ComputedRef } from 'vue'
import { useCanAnswers } from './useCanAnswers'

export interface UseCanOptions {
  /** false → only fetch in the browser (for cached public pages). Default true. */
  server?: boolean
}

export function useCan(action: string | string[], options: UseCanOptions = {}): ComputedRef<boolean> {
  const actions = [...new Set((Array.isArray(action) ? action : [action]).filter(Boolean))]
  const { teamId } = useTeamContext()
  const requestFetch = useRequestFetch()
  const answers = useCanAnswers()
  const clientOnly = options.server === false

  type Answer = { teamId: string | null, allowed: Record<string, boolean> }

  // A static key + `watch` (not a reactive key, which needs Nuxt ≥3.17) so a
  // team switch refetches on every Nuxt the package supports. A browser-only
  // call gets its own key so it never shares a server-rendered answer.
  const { data } = useAsyncData<Answer>(
    `crouton-can:${actions.join(',')}${clientOnly ? ':client' : ''}`,
    async () => {
      const id = teamId.value ?? null
      if (!id || actions.length === 0) return { teamId: id, allowed: {} }
      const allowed = await requestFetch<Record<string, boolean>>(`/api/teams/${id}/can`, {
        query: { actions: actions.join(',') }
      })
      answers.value = { ...answers.value, [id]: { ...answers.value[id], ...allowed } }
      return { teamId: id, allowed }
    },
    {
      watch: [teamId],
      default: () => ({ teamId: null, allowed: {} }),
      ...(clientOnly ? { server: false } : {})
    }
  )

  // Only trust an answer for the team we are in now: after a team switch the
  // previous team's answer stays in `data` until the new one arrives.
  return computed(() => {
    const answer = data.value
    if (!answer || !teamId.value || answer.teamId !== teamId.value) return false
    return actions.length > 0 && actions.every(a => answer.allowed[a] === true)
  })
}
