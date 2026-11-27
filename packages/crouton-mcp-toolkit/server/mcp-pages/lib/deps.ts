/**
 * The real deps for the pages tools (#3982): crouton-pages' read-only page
 * source, crouton-collab's live-room helpers and crouton-layout's placement
 * check, crouton-auth's team lookups (`team-lookup.ts`), plus the app's
 * layout-block registry. Static imports — these packages
 * are declared optional peers, and this folder only loads with `pages: true`
 * (which the module refuses unless crouton-pages + crouton-collab are extended).
 */
import { readCollabRoomDoc, updateCollabRoomDoc } from '@fyit/crouton-collab/server/utils/collabServerDoc'
import { createPageForMcp, getStoredPageContentForMcp, listTeamPagesForMcp } from '@fyit/crouton-pages/server/utils/page-live-source'
import { checkLayoutForPlacement } from '@fyit/crouton-layout/app/utils/layout-placement-check'
import type { PagesToolDeps } from './tools'
import type { PagesAccess } from './auth'
import { pagesTeamDeps } from './team-lookup'
import { registeredPageTypes, type PageTypeAppConfig } from './page-types'

export function pagesToolDeps(): PagesToolDeps {
  const appConfig = useAppConfig() as PageTypeAppConfig & { croutonLayoutBlocks?: PagesToolDeps['registry'] }
  const registry = appConfig.croutonLayoutBlocks ?? {}
  const runtime = useRuntimeConfig() as { croutonI18n?: { defaultLocale?: string } }
  return {
    teams: pagesTeamDeps(),
    pages: { listTeamPagesForMcp, getStoredPageContentForMcp, createPageForMcp },
    room: {
      readCollabRoomDoc: ref => readCollabRoomDoc(ref),
      updateCollabRoomDoc: (ref, mutate, options) => updateCollabRoomDoc(ref, mutate, { presence: options?.presence })
    },
    registry,
    checkLayout: checkLayoutForPlacement,
    defaultLocale: runtime.croutonI18n?.defaultLocale || 'en',
    pageTypes: registeredPageTypes(appConfig)
  }
}

/** The pages access the handler middleware put on the event (undefined → refused). */
export function pagesAccess(): PagesAccess | undefined {
  return (useEvent().context as { croutonMcpPages?: PagesAccess }).croutonMcpPages
}
