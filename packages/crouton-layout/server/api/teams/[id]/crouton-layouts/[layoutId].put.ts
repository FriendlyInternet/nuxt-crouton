import { eq, and } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { layoutConfigs } from '../../../../database/schema/layoutConfigs'
import { sanitizeLayoutTree } from '../../../../../app/utils/layout-tree'

/**
 * Upsert a saved layout tree by id, scoped to the caller's team (#706).
 *
 * The tree is UNTRUSTED input. We run it through the pure `sanitizeLayoutTree`
 * shape gate on the way in — dropping stray keys / prototype pollution and
 * rejecting structurally invalid trees — and store the CLEANED tree, so a
 * malformed/hostile payload never reaches the renderer (which additionally
 * allowlists each leaf's `blockId` against the registry and sanitizes per-block
 * config at render). Defence in depth: validate on write, allowlist on render.
 */
export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()
  const layoutId = getRouterParam(event, 'layoutId')!

  const body = await readBody<{ tree?: unknown }>(event)
  const tree = sanitizeLayoutTree(body?.tree)
  if (!tree) {
    throw createError({ status: 400, statusText: 'valid layout tree required' })
  }

  const [existing] = await db
    .select()
    .from(layoutConfigs)
    .where(and(eq(layoutConfigs.id, layoutId), eq(layoutConfigs.teamId, team.id)))
    .limit(1)

  if (existing) {
    await db
      .update(layoutConfigs)
      .set({ tree: tree as unknown as Record<string, unknown> })
      .where(and(eq(layoutConfigs.id, layoutId), eq(layoutConfigs.teamId, team.id)))
  }
  else {
    await db.insert(layoutConfigs).values({
      id: layoutId,
      teamId: team.id,
      name: 'layout',
      renderer: 'panes',
      tree: tree as unknown as Record<string, unknown>,
    })
  }

  return { ok: true }
})
