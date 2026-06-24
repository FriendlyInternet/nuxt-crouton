import { ref, readonly } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { sanitizeLayoutTree } from '../utils/layout-tree'

/**
 * Persistence for editable layouts (Sprint 3, #706) — load/save a `LayoutTree`
 * to the team-scoped `layout_configs` table via REST. The production successor
 * to the spike store (#713).
 *
 * The tree is untrusted on the way back out of storage too, so `load` runs it
 * through `sanitizeLayoutTree` (the same shape gate the server applies on write)
 * before handing it to the editor — a row tampered with directly in the DB still
 * can't feed the renderer a malformed tree. `save` is debounced so a flurry of
 * resize/drag edits collapses into one write.
 */
export function useCroutonLayoutStore() {
  const { getTeamId } = useTeamContext()
  const saving = ref(false)
  const error = ref<Error | null>(null)

  async function load(layoutId: string): Promise<LayoutTree | null> {
    const teamId = getTeamId()
    if (!teamId) return null
    try {
      const row = await $fetch<{ tree?: unknown } | null>(
        `/api/teams/${teamId}/crouton-layouts/${layoutId}`,
        { credentials: 'include' },
      )
      return sanitizeLayoutTree(row?.tree)
    }
    catch (e) {
      error.value = e instanceof Error ? e : new Error('Failed to load layout')
      return null
    }
  }

  const save = useDebounceFn(async (layoutId: string, tree: LayoutTree) => {
    const teamId = getTeamId()
    if (!teamId) return
    saving.value = true
    error.value = null
    try {
      await $fetch(`/api/teams/${teamId}/crouton-layouts/${layoutId}`, {
        method: 'PUT',
        body: { tree },
        credentials: 'include',
      })
    }
    catch (e) {
      error.value = e instanceof Error ? e : new Error('Failed to save layout')
    }
    finally {
      saving.value = false
    }
  }, 600)

  return { load, save, saving: readonly(saving), error: readonly(error) }
}
