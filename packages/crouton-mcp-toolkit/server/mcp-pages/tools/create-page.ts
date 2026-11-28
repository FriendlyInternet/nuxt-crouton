import { z } from 'zod'
import { createPageTool } from '../lib/tools'
import { pagesAccess, pagesToolDeps } from '../lib/deps'

/**
 * The page settings a person sets in the admin, mirroring the create endpoint's
 * body (crouton-pages `pages-pages/index.post.ts`) minus status / publishedAt.
 * `visibility` takes the page schema's options (`schemas/pages.json`).
 */
export const createPageInputSchema = {
  team: z.string().describe('team slug or id from list_teams'),
  locale: z.string().describe('The app\'s default locale (other locales: edit_page on the new page)'),
  title: z.string().min(1),
  slug: z.string().min(1).describe('URL part, unique in the team, e.g. "about-us"'),
  parentId: z.string().optional().describe('Parent page id from list_pages (nests the page under it)'),
  blocks: z.array(z.object({ type: z.string() }).passthrough()).optional()
    .describe('TipTap block nodes, e.g. { "type": "paragraph", "content": [{ "type": "text", "text": "Hi" }] }'),
  pageType: z.string().optional().describe('A registered page type, default "pages:regular"'),
  visibility: z.enum(['public', 'members', 'admin', 'scoped', 'hidden']).optional()
    .describe('Who can see it, default "public" ("scoped": set the access code in the admin)'),
  showInNavigation: z.boolean().optional(),
  layout: z.string().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  ogImage: z.string().optional(),
  robots: z.string().optional().describe('e.g. "noindex"'),
  config: z.object({
    hideNav: z.boolean().optional(),
    hideAuthControls: z.boolean().optional(),
    requiredScope: z.string().optional()
  }).passthrough().optional(),
  // A plain shape strips unknown keys silently; these make the schema REFUSE them (Rule C)
  status: z.never().optional().describe('Not accepted: pages are created as drafts'),
  publishedAt: z.never().optional().describe('Not accepted: publish in the Pages admin')
}

export default defineMcpTool({
  name: 'create_page',
  description: 'Create a new page as a DRAFT (never published) in a team, in the app\'s default locale, with its title, slug, optional parent, text blocks and settings (who can see it, SEO, navigation). The owner publishes it in the Pages admin. Settings can\'t be changed later with this tool. Returns { pageId }.',
  inputSchema: createPageInputSchema,
  async handler(args) {
    return createPageTool(pagesAccess(), args as Parameters<typeof createPageTool>[1], pagesToolDeps())
  }
})
