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

  const { data } = useAsyncData(
    () => `crouton-can:${teamId.value ?? ''}:${actions.join(',')}`,
    async () => {
      if (!teamId.value || actions.length === 0) return {} as Record<string, boolean>
      return await requestFetch<Record<string, boolean>>(`/api/teams/${teamId.value}/can`, {
        query: { actions: actions.join(',') }
      })
    },
    // The key is reactive, so a team switch refetches on its own.
    { default: () => ({} as Record<string, boolean>) }
  )

  return computed(() => actions.length > 0 && actions.every(a => data.value?.[a] === true))
}
