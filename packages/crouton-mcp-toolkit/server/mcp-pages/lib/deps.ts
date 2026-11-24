/**
 * The real deps for the pages tools (#3982): crouton-pages' read-only page
 * source, crouton-collab's live-room helpers and crouton-layout's placement
 * check, crouton-auth's team lookups (`team-lookup.ts`), plus the app's
 * layout-block registry. Static imports — these packages
 * are declared optional peers, and this folder only loads with `pages: true`
 * (which the module refuses unless crouton-pages + crouton-collab are extended).
 */
import { readCollabRoomDoc, updateCollabRoomDoc } from '@fyit/crouton-collab/server/utils/collabServerDoc'
import { getStoredPageContentForMcp, listTeamPagesForMcp } from '@fyit/crouton-pages/server/utils/page-live-source'
import { checkLayoutForPlacement } from '@fyit/crouton-layout/app/utils/layout-placement-check'
import type { PagesToolDeps } from './tools'
import type { PagesAccess } from './auth'
import { pagesTeamDeps } from './team-lookup'

export function pagesToolDeps(): PagesToolDeps {
  const registry = ((useAppConfig() as { croutonLayoutBlocks?: PagesToolDeps['registry'] }).croutonLayoutBlocks) ?? {}
  return {
    teams: pagesTeamDeps(),
    pages: { listTeamPagesForMcp, getStoredPageContentForMcp },
    room: {
      readCollabRoomDoc: ref => readCollabRoomDoc(ref),
      updateCollabRoomDoc: (ref, mutate) => updateCollabRoomDoc(ref, mutate)
    },
    registry,
    checkLayout: checkLayoutForPlacement
  }
}

/** The pages access the handler middleware put on the event (undefined → refused). */
export function pagesAccess(): PagesAccess | undefined {
  return (useEvent().context as { croutonMcpPages?: PagesAccess }).croutonMcpPages
}
