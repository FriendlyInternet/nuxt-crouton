/**
 * Seed script for alexdeforce pages migration
 *
 * Reads page markdown files from the old alexdeforce_v2 site,
 * parses YAML frontmatter + markdown body, converts to TipTap JSON,
 * and inserts into the pages_pages table.
 *
 * Pages with `external: true` become `core:link` pages with URL in config.
 * Pages with `external: false` become `core:regular` content pages.
 *
 * Trigger via POST /api/seed/pages
 */
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { organization, member } from '~~/server/db/schema'
import { pagesPages } from '@fyit/crouton-pages/collections/pages/server/database/schema'

const SOURCE_DIR = '/Users/pmcp/Projects/alexdeforce_v2/content/pages'

/** Parse YAML frontmatter from markdown */
function parseFrontmatter(md: string): { data: Record<string, any>; content: string } {
  const match = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { data: {}, content: md }
  return {
    data: parseSimpleYaml(match[1]!),
    content: match[2]!.trim()
  }
}

function parseSimpleYaml(yaml: string): Record<string, any> {
  const result: Record<string, any> = {}
  const lines = yaml.split('\n')

  for (const line of lines) {
    if (line.trim() === '') continue
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (m) {
      let value = m[2]!.trim()
      if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1)
      }
      if (value === 'true') { result[m[1]!] = true; continue }
      if (value === 'false') { result[m[1]!] = false; continue }
      result[m[1]!] = value
    }
  }
  return result
}

// TipTap JSON builders
interface TipTapNode {
  type: string
  attrs?: Record<string, any>
  content?: TipTapNode[]
  marks?: Array<{ type: string; attrs?: Record<string, any> }>
  text?: string
}

function doc(...content: TipTapNode[]): string {
  return JSON.stringify({
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }]
  })
}

function heading(level: number, ...content: TipTapNode[]): TipTapNode {
  return { type: 'heading', attrs: { level }, content }
}

function paragraph(...content: TipTapNode[]): TipTapNode {
  if (content.length === 0) return { type: 'paragraph' }
  return { type: 'paragraph', content }
}

function textNode(str: string, marks?: TipTapNode['marks']): TipTapNode {
  const node: TipTapNode = { type: 'text', text: str }
  if (marks && marks.length > 0) node.marks = marks
  return node
}

function bold(str: string): TipTapNode {
  return textNode(str, [{ type: 'bold' }])
}

function italic(str: string): TipTapNode {
  return textNode(str, [{ type: 'italic' }])
}

function link(label: string, href: string): TipTapNode {
  return textNode(label, [{ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null } }])
}

function hardBreak(): TipTapNode {
  return { type: 'hardBreak' }
}

function bulletList(...items: TipTapNode[][]): TipTapNode {
  return {
    type: 'bulletList',
    content: items.map(itemContent => ({
      type: 'listItem',
      content: [paragraph(...itemContent)]
    }))
  }
}

function embedBlockNode(url: string, height: number = 300): TipTapNode {
  return {
    type: 'embedBlock',
    attrs: {
      blockId: `embed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url,
      provider: 'custom',
      height,
      caption: ''
    }
  }
}

function extractIframeSrc(html: string): string | null {
  const match = html.match(/src=["']([^"']+)["']/)
  return match ? match[1]! : null
}

/** Parse inline markdown into TipTap text nodes with marks */
function parseInline(raw: string, outerMarks: TipTapNode['marks'] = []): TipTapNode[] {
  const nodes: TipTapNode[] = []
  const pattern = /\[([^\]]*)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      const node: TipTapNode = { type: 'text', text: raw.slice(lastIndex, match.index) }
      if (outerMarks.length > 0) node.marks = [...outerMarks]
      nodes.push(node)
    }

    if (match[1] !== undefined) {
      // Link — combine outer marks with link mark
      const linkMark = { type: 'link', attrs: { href: match[2]!, target: '_blank', rel: 'noopener noreferrer nofollow', class: null } }
      const node: TipTapNode = { type: 'text', text: match[1]!, marks: [...outerMarks, linkMark] }
      nodes.push(node)
    } else if (match[3] !== undefined) {
      // Bold — recursively parse contents with bold mark added
      nodes.push(...parseInline(match[3]!, [...outerMarks, { type: 'bold' }]))
    } else if (match[4] !== undefined) {
      // Italic — recursively parse contents with italic mark added
      nodes.push(...parseInline(match[4]!, [...outerMarks, { type: 'italic' }]))
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < raw.length) {
    const node: TipTapNode = { type: 'text', text: raw.slice(lastIndex) }
    if (outerMarks.length > 0) node.marks = [...outerMarks]
    nodes.push(node)
  }

  if (nodes.length === 0) {
    const node: TipTapNode = { type: 'text', text: raw }
    if (outerMarks.length > 0) node.marks = [...outerMarks]
    return [node]
  }
  return nodes
}

/** Convert markdown to TipTap JSON */
function markdownToTipTap(md: string): string {
  if (!md || !md.trim()) return doc()

  const rawBlocks = md.split(/\n\n+/).filter(b => b.trim())
  const docNodes: TipTapNode[] = []

  for (const block of rawBlocks) {
    const trimmed = block.trim()

    // Iframes → embedBlock
    if (trimmed.startsWith('<iframe')) {
      const src = extractIframeSrc(trimmed)
      if (src) {
        const height = trimmed.includes('height="352"') ? 352
          : trimmed.includes('height="786"') ? 786
          : 300
        docNodes.push(embedBlockNode(src, height))
      }
      continue
    }

    // Heading
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      docNodes.push(heading(headingMatch[1]!.length, ...parseInline(headingMatch[2]!.trim())))
      continue
    }

    // List items
    if (trimmed.split('\n').some(l => l.trim().match(/^[\*\-]\s/))) {
      const items = trimmed
        .split('\n')
        .filter(l => l.trim())
        .map(l => l.trim().replace(/^[\*\-]\s*/, '').trim())
        .filter(t => t)
        .map(t => parseInline(t))
      if (items.length > 0) docNodes.push(bulletList(...items))
      continue
    }

    // Regular paragraph with line breaks
    const lines = trimmed.split('\n').map(l => l.replace(/\\$/, '').trim())
    const paraNodes: TipTapNode[] = []
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!
      if (!line) continue

      if (line.startsWith('<iframe')) {
        const src = extractIframeSrc(line)
        if (src) {
          if (paraNodes.length > 0) {
            docNodes.push(paragraph(...paraNodes.splice(0)))
          }
          docNodes.push(embedBlockNode(src, 300))
        }
        continue
      }

      if (paraNodes.length > 0) paraNodes.push(hardBreak())
      paraNodes.push(...parseInline(line))
    }
    if (paraNodes.length > 0) docNodes.push(paragraph(...paraNodes))
  }

  return doc(...docNodes)
}

export default defineEventHandler(async () => {
  if (!import.meta.dev) {
    throw createError({ status: 403, statusText: 'Seed endpoint is only available in development' })
  }

  const db = useDB()
  const log: string[] = []
  const now = new Date()

  try {
    // Find the organization
    const orgs = await (db as any).select().from(organization).limit(1)
    if (orgs.length === 0) {
      throw createError({
        status: 404,
        statusText: 'No organization found. Start the dev server and create one via admin first.'
      })
    }
    const orgId = orgs[0].id

    // Find an actual user to use as owner
    const members = await (db as any).select().from(member).where(eq(member.organizationId, orgId)).limit(1)
    const ownerId = members?.[0]?.userId || orgId

    log.push(`Using organization: ${orgs[0].name} (${orgId})`)

    // Clear existing pages for this org
    await (db as any).delete(pagesPages).where(eq(pagesPages.teamId, orgId))
    log.push('Cleared existing pages')

    // Read all page markdown files
    const pageFiles = readdirSync(SOURCE_DIR).filter(f => f.endsWith('.md')).sort()
    let pageCount = 0

    for (const file of pageFiles) {
      const filePath = resolve(SOURCE_DIR, file)
      const raw = readFileSync(filePath, 'utf-8')
      const { data, content } = parseFrontmatter(raw)

      if (!data.title) {
        log.push(`SKIP page (no title): ${file}`)
        continue
      }

      const slug = file.replace(/\.md$/, '')
      const isExternal = data.external === true
      const isMailingList = content.trim() === ':mailing'
      const pageType = isExternal ? 'core:link' : 'core:regular'
      const config = isExternal && data.url ? { url: data.url } : {}

      let tipTapContent: string | null = null
      if (isExternal) {
        tipTapContent = null
      } else if (isMailingList) {
        // Create a TipTap doc with a mailingListBlock node
        tipTapContent = JSON.stringify({
          type: 'doc',
          content: [{
            type: 'mailingListBlock',
            attrs: {
              action: 'https://on-point.us5.list-manage.com/subscribe/post?u=01d6de19e17593ce2f49c0c05&id=e19324ec26&f_id=00d678ebf0',
              honeypotName: 'b_01d6de19e17593ce2f49c0c05_e19324ec26'
            }
          }]
        })
      } else {
        tipTapContent = markdownToTipTap(content)
      }

      const pageId = nanoid()
      await (db as any).insert(pagesPages).values({
        id: pageId,
        teamId: orgId,
        owner: ownerId,
        parentId: null,
        path: `/${slug}`,
        depth: 0,
        order: pageCount,
        title: data.title,
        slug,
        pageType,
        content: tipTapContent,
        config,
        status: 'published',
        visibility: 'public',
        publishedAt: data.date ? new Date(data.date) : now,
        showInNavigation: true,
        layout: 'default',
        seoTitle: null,
        seoDescription: null,
        ogImage: null,
        robots: 'index',
        translations: {},
        createdAt: now,
        updatedAt: now,
        createdBy: ownerId,
        updatedBy: ownerId
      })

      log.push(`Created page: ${data.title} (${pageType}${isExternal ? ` → ${data.url}` : ''})`)
      pageCount++
    }

    return {
      success: true,
      organizationId: orgId,
      summary: log,
      counts: { pages: pageCount }
    }
  } catch (error: any) {
    if (error.statusCode || error.status) throw error
    console.error('Seed error:', error)
    throw createError({
      status: 500,
      statusText: `Seed failed: ${error.message}\n${error.stack || ''}`
    })
  }
})