/**
 * Import Vélo Solidaire's site content (pages) from the old site's export, in ONE step.
 *
 * Reads `<source>/content/pages/*.{fr,nl}.md` (frontmatter `elements` + body markdown) and
 * `<source>/static/img/*` (or `<source>/img/*`), uploads every referenced image/PDF to blob,
 * and writes each page as TipTap JSON using the page editor's own blocks:
 *   text (markdown)  → headings / paragraphs / lists / links; inline images → imageBlock
 *   logos            → logoBlock
 *   buttons          → buttonRowBlock (download → uploaded file, link → `to`)
 *   frontmatter image→ imageBlock at the top
 * The old site's sign-up `form` is not carried over (velo has its own sign-up).
 *
 * Updates the velo-solidaire team's existing pages by slug (creates missing ones).
 * Replaces the plain-text page import + the hand-written pages-fix step (#2255).
 *
 * POST /api/seed/velosolidaire-content   body: { source?: string }  (default: seedData/velosolidaire)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join, extname } from 'node:path'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { parse as parseYaml } from 'yaml'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { organization } from '~~/server/db/schema'
import { pagesPages } from '@fyit/crouton-pages/collections/pages/server/database/schema'
import { bookingsLocations } from '@fyit/crouton-bookings/collections/locations/server/database/schema'

const HOME_VIDEO = 'https://iframe.mediadelivery.net/embed/350779/0ef64869-4ad6-484b-93e8-cfa8c80dc163?autoplay=false&loop=false&muted=false&preload=true&responsive=true'

type Node = { type: string, attrs?: Record<string, any>, content?: Node[], marks?: { type: string, attrs?: Record<string, any> }[], text?: string }

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf'
}

/** Accent-free slug, matching the slugs the page import created (à → a). */
function toSlug(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** The old site's Dutch files contain a few sentences left in French — translated here */
const NL_FIXES: [string, string][] = [
  ["Les vélos de la flotte d'Evere ont été achetés grâce au soutien de la Loterie Nationale.",
    'De fietsen van de vloot in Evere werden aangekocht met de steun van de Nationale Loterij.'],
]
function fixDutch(md: string): string {
  return NL_FIXES.reduce((out, [fr, nl]) => out.split(fr).join(nl), md)
}

function splitFrontmatter(md: string): { data: Record<string, any>, body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: md }
  return { data: (parseYaml(m[1]!) as Record<string, any>) || {}, body: m[2]!.trim() }
}

// ---------------------------------------------------------------------------
// Asset upload (each source path uploaded once per run)
// ---------------------------------------------------------------------------

function makeUploader(imgDir: string | null, teamId: string, log: string[]) {
  const cache = new Map<string, string>()
  return async function upload(src: string | null | undefined): Promise<string | null> {
    if (!src) return null
    if (/^https?:\/\//.test(src)) return src
    if (cache.has(src)) return cache.get(src)!
    const file = decodeURIComponent(src.replace(/^\/?img\//, ''))
    const path = imgDir ? join(imgDir, file) : null
    if (!path || !existsSync(path)) {
      log.push(`WARNING: asset not found: ${src}`)
      cache.set(src, '')
      return null
    }
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
    const res = await blob.put(file, new Blob([readFileSync(path)], { type }), {
      addRandomSuffix: true,
      prefix: `teams/${teamId}/site`
    })
    const url = `/images/${res.pathname}`
    cache.set(src, url)
    return url
  }
}

// ---------------------------------------------------------------------------
// Markdown (mdast) → TipTap
// ---------------------------------------------------------------------------

type Upload = ReturnType<typeof makeUploader>

const LINKIFY = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?:\/\/[^\s)]+/g
/** Links to old-site pages (velosolidaire.brussels/<page>.<lang>) → the same page in velo */
const SLUG_ALIASES: Record<string, string> = { 'nos-parcours-et-services': 'parcours' }
function rewriteOldSiteLink(url: string): string {
  const m = url.match(/^https?:\/\/(?:www\.)?velosolidaire\.brussels\/(?:(locations)\/)?([^./?#]+)\.(fr|nl)\/?$/)
  if (!m) return url
  const [, section, name, lang] = m
  if (section === 'locations') return `/velo-solidaire/${lang}/bookings`
  const slug = SLUG_ALIASES[name!] ?? toSlug(decodeURIComponent(name!))
  return `/velo-solidaire/${lang}/${slug === 'homepage' ? '' : slug}`
}

function textNode(text: string, marks: Node['marks'] = []): Node {
  return marks.length ? { type: 'text', text, marks } : { type: 'text', text }
}

function inline(nodes: any[], marks: Node['marks'] = []): Node[] {
  const out: Node[] = []
  for (const n of nodes) {
    switch (n.type) {
      case 'text': {
        // The old CMS leaves zero-width chars in text ("P﻿rojet")
        const text = String(n.value).replace(/[﻿​]/g, '')
        if (!text) break
        // Linkify bare emails/URLs (the old site's markdown-it rendered them as links)
        if (marks.some(m => m.type === 'link')) { out.push(textNode(text, marks)); break }
        let last = 0
        for (const m of text.matchAll(LINKIFY)) {
          if (m.index! > last) out.push(textNode(text.slice(last, m.index), marks))
          const href = m[0].includes('@') && !m[0].startsWith('http') ? `mailto:${m[0]}` : m[0]
          out.push(textNode(m[0], [...marks, { type: 'link', attrs: { href, target: href.startsWith('http') ? '_blank' : null } }]))
          last = m.index! + m[0].length
        }
        if (last < text.length) out.push(textNode(text.slice(last), marks))
        break
      }
      // ***text*** (bold + italic) is the old site's highlight → TipTap's highlight mark + bold
      case 'strong':
      case 'emphasis': {
        const other = n.type === 'strong' ? 'emphasis' : 'strong'
        if (n.children.length === 1 && n.children[0].type === other) {
          out.push(...inline(n.children[0].children, [...marks, { type: 'bold' }, { type: 'highlight' }]))
        } else {
          out.push(...inline(n.children, [...marks, { type: n.type === 'strong' ? 'bold' : 'italic' }]))
        }
        break
      }
      case 'delete': out.push(...inline(n.children, [...marks, { type: 'strike' }])); break
      case 'inlineCode': out.push({ type: 'text', text: n.value, marks: [...marks, { type: 'code' }] }); break
      case 'link': {
        const href = rewriteOldSiteLink(n.url)
        out.push(...inline(n.children, [...marks, { type: 'link', attrs: { href, target: /^https?:/.test(href) ? '_blank' : null } }]))
        break
      }
      case 'break': out.push({ type: 'hardBreak' }); break
      // images are lifted out to block level by `blocks()`; html is dropped
    }
  }
  return out
}

async function blocks(nodes: any[], upload: Upload): Promise<Node[]> {
  const out: Node[] = []
  for (const n of nodes) {
    switch (n.type) {
      case 'heading': {
        const content = inline(n.children)
        if (content.length) out.push({ type: 'heading', attrs: { level: Math.min(Math.max(n.depth, 1), 3) }, content })
        break
      }
      case 'paragraph': {
        // Split around images: text runs stay paragraphs, each image becomes an imageBlock
        let run: any[] = []
        const flush = () => {
          const content = inline(run)
          while (content[0]?.type === 'hardBreak') content.shift()
          while (content.at(-1)?.type === 'hardBreak') content.pop()
          if (content.some(c => c.type === 'text')) out.push({ type: 'paragraph', content })
          run = []
        }
        for (const c of n.children) {
          if (c.type === 'image') {
            flush()
            const src = await upload(c.url)
            if (src) out.push({ type: 'imageBlock', attrs: { src, alt: c.alt || '', caption: '', width: 'full', frame: false } }) // images inside text (logos) go bare
          } else run.push(c)
        }
        flush()
        break
      }
      case 'list':
        out.push({
          type: n.ordered ? 'orderedList' : 'bulletList',
          content: await Promise.all(n.children.map(async (li: any) => {
            const content = await blocks(li.children, upload)
            return { type: 'listItem', content: content.length ? content : [{ type: 'paragraph' }] }
          }))
        })
        break
      case 'blockquote': out.push({ type: 'blockquote', content: await blocks(n.children, upload) }); break
      case 'thematicBreak': out.push({ type: 'horizontalRule' }); break
      case 'code': out.push({ type: 'codeBlock', content: [{ type: 'text', text: n.value }] }); break
    }
  }
  return out
}

async function markdownToNodes(md: string | undefined, upload: Upload): Promise<Node[]> {
  if (!md?.trim()) return []
  return blocks(fromMarkdown(md).children, upload)
}

// ---------------------------------------------------------------------------
// TipTap nodes → HTML (location descriptions are stored as HTML)
// ---------------------------------------------------------------------------

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const MARK_TAGS: Record<string, string> = { bold: 'strong', italic: 'em', strike: 's', code: 'code', highlight: 'mark' }

function nodesToHtml(nodes: Node[] = []): string {
  return nodes.map((n) => {
    switch (n.type) {
      case 'text': {
        let out = esc(n.text || '')
        for (const m of n.marks || []) {
          if (m.type === 'link') out = `<a href="${esc(String(m.attrs?.href || ''))}"${m.attrs?.target ? ' target="_blank" rel="noopener"' : ''}>${out}</a>`
          else if (MARK_TAGS[m.type]) out = `<${MARK_TAGS[m.type]}>${out}</${MARK_TAGS[m.type]}>`
        }
        return out
      }
      case 'hardBreak': return '<br>'
      case 'paragraph': return `<p>${nodesToHtml(n.content)}</p>`
      case 'heading': return `<h${n.attrs?.level || 2}>${nodesToHtml(n.content)}</h${n.attrs?.level || 2}>`
      case 'bulletList': return `<ul>${nodesToHtml(n.content)}</ul>`
      case 'orderedList': return `<ol>${nodesToHtml(n.content)}</ol>`
      case 'listItem': return `<li>${nodesToHtml(n.content)}</li>`
      case 'blockquote': return `<blockquote>${nodesToHtml(n.content)}</blockquote>`
      case 'horizontalRule': return '<hr>'
      case 'imageBlock': return `<p><img src="${esc(String(n.attrs?.src || ''))}" alt="${esc(String(n.attrs?.alt || ''))}"></p>`
      default: return nodesToHtml(n.content)
    }
  }).join('')
}

// ---------------------------------------------------------------------------
// Page frontmatter → TipTap doc
// ---------------------------------------------------------------------------

/** Old site: pages with a photo (not Home's video, not Réservations' photo header) showed it beside the text */
function photoBesideText(name: string, data: Record<string, any>): boolean {
  return name !== 'homepage' && name !== 'bookings' && !!data.image && data.image !== 'null' && String(data.layout ?? '') !== '1'
}

async function pageDoc(data: Record<string, any>, body: string, upload: Upload, pageName = ''): Promise<string> {
  const content: Node[] = []

  // The old site's Home shows a video (hard-coded in its pages/_page.vue) instead of the header image
  if (data.title === 'Home' || data.title === 'Accueil') {
    content.push({ type: 'videoBlock', attrs: { src: HOME_VIDEO, caption: '', width: 'full', autoplay: false, loop: false } }) // video block: 16:9, full width
  } else {
    const header = await upload(data.image)
    if (header) content.push({ type: 'imageBlock', attrs: { src: header, alt: data.title || '', caption: '', width: 'full' } })
  }
  if (data.intro) content.push({ type: 'paragraph', content: [{ type: 'text', text: String(data.intro), marks: [{ type: 'italic' }] }] })

  for (const el of (data.elements || []) as any[]) {
    if (el.type === 'text') {
      content.push(...await markdownToNodes(el.markdown, upload))
    } else if (el.type === 'logos') {
      const items = []
      for (const l of el.logo || []) {
        const value = await upload(l.image)
        if (value) items.push({ type: 'image', value, alt: l.name || '', link: l.link || '' })
      }
      if (items.length) content.push({ type: 'logoBlock', attrs: { title: el.title || '', marquee: false, align: 'center', size: 'sm', items } })
    } else if (el.type === 'buttons') {
      const buttons = []
      for (const b of el.button || []) {
        if (b.download) {
          const file = await upload(b.download)
          if (file) buttons.push({ label: b.label, file, fileName: decodeURIComponent(String(b.download).split('/').pop() || ''), download: true })
        } else if (b.link || b.url || b.to) {
          const to = b.link || b.url || b.to
          buttons.push({ label: b.label, to, external: /^https?:/.test(to) })
        }
      }
      if (buttons.length) content.push({ type: 'buttonRowBlock', attrs: { buttons, align: 'left' } })
    }
  }

  // The old site renders only `elements` (components/PageContent.vue); the body below the
  // frontmatter is leftover draft text there, so it is not imported. Pages without elements keep it.
  if (!(data.elements || []).length) content.push(...await markdownToNodes(body, upload))

  // The old site's booking page had its reservation tool built in; velo's is the booking block.
  // Logged-in users book; logged-out visitors get a sign-in prompt instead of the tool.
  if (pageName === 'bookings') {
    // Right after the intro paragraph (the first paragraph under the title), above the rules
    const block = { type: 'bookingBlock', attrs: { title: '', emptyMessage: '', loggedOut: 'prompt', scope: 'personal', showLocations: true, showMap: true } }
    const heading = content.findIndex(n => n.type === 'heading')
    const intro = content.findIndex((n, i) => i > heading && n.type === 'paragraph')
    content.splice(intro >= 0 ? intro + 1 : content.length, 0, block)
  }
  // Photo beside the text → one "Image + text" block holding the rest of the page
  if (photoBesideText(pageName, data) && content[0]?.type === 'imageBlock' && content.length > 1) {
    const [photo, ...rest] = content
    return JSON.stringify({ type: 'doc', content: [{
      type: 'mediaTextBlock',
      attrs: { src: photo!.attrs?.src, alt: photo!.attrs?.alt || '', side: 'left', sticky: true, frame: true },
      content: rest
    }] })
  }
  return JSON.stringify({ type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] })
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) {
    throw createError({ status: 403, statusText: 'Seed endpoint is only available in development' })
  }

  const body = await readBody<{ source?: string, only?: string[] }>(event).catch(() => ({} as { source?: string, only?: string[] }))
  const source = body?.source
    ? resolve(body.source)
    : [resolve(process.cwd(), 'seedData/velosolidaire'), resolve(process.cwd(), 'apps/velo/seedData/velosolidaire')].find(existsSync)
  const pagesDir = source && join(source, 'content/pages')
  if (!pagesDir || !existsSync(pagesDir)) {
    throw createError({ status: 400, statusText: `No content/pages folder in ${source}` })
  }
  const imgDir = [join(source!, 'static/img'), join(source!, 'img')].find(existsSync) || null

  const db = useDB()
  const log: string[] = [`Source: ${source}`, `Images: ${imgDir ?? 'none found'}`]

  const [org] = await (db as any).select().from(organization).where(eq(organization.slug, 'velo-solidaire')).limit(1)
  if (!org) throw createError({ status: 400, statusText: 'Team velo-solidaire not found — run POST /api/seed/velosolidaire first' })

  const upload = makeUploader(imgDir, org.id, log)
  const names = [...new Set(readdirSync(pagesDir).filter(f => f.endsWith('.fr.md')).map(f => f.slice(0, -'.fr.md'.length)))]
  const now = new Date()
  const navPath = join(source!, 'content/site/navigation.json')
  const navPages: Set<string> | null = existsSync(navPath)
    ? new Set(((JSON.parse(readFileSync(navPath, 'utf-8')).navigation || []) as { page?: string }[]).map(n => n.page || '').filter(Boolean))
    : null
  const teamPages = await (db as any).select({ id: pagesPages.id, slug: pagesPages.slug, title: pagesPages.title, translations: pagesPages.translations, owner: pagesPages.owner })
    .from(pagesPages).where(eq(pagesPages.teamId, org.id))
  const adminId = teamPages.find((p: any) => p.owner)?.owner ?? null

  for (const [idx, name] of names.entries()) {
    // The old sign-up form page: velo has its own sign-up, so it is not carried over
    if (name === 'register') continue
    // Optional: re-import only some pages (by source file name or slug), leaving the rest as edited
    if (body?.only?.length && !body.only.includes(name) && !body.only.includes(toSlug(name))) continue
    const fr = splitFrontmatter(readFileSync(join(pagesDir, `${name}.fr.md`), 'utf-8'))
    const nlPath = join(pagesDir, `${name}.nl.md`)
    const nl = existsSync(nlPath) ? splitFrontmatter(fixDutch(readFileSync(nlPath, 'utf-8'))) : fr

    const frDoc = await pageDoc(fr.data, fr.body, upload, name)
    const nlDoc = await pageDoc(nl.data, nl.body, upload, name)
    const frTitle = fr.data.title || name
    const nlTitle = nl.data.title || frTitle
    const sourceSlug = toSlug(name)
    // Social-share image: the uploaded header (the old import left the old site's /img path).
    const ogImage = await upload(fr.data.image)
    const published = fr.data.draft !== true
    // The old site's menu is site/navigation.json; fall back to the page's own `nav` flag
    const showInNavigation = navPages ? navPages.has(name) : fr.data.nav !== false
    // Réservations: photo header (full width, behind the menu) above the booking module
    const config = name === 'bookings' ? { headerMedia: true } : {}

    // Match an existing page by slug, else by title — so a slug renamed in the editor is
    // recognised (and kept) instead of colliding with a second copy of the page.
    const existing = teamPages.find((p: any) => p.slug === sourceSlug) || teamPages.find((p: any) => p.title === frTitle)
    const prev = (existing?.translations || {}) as Record<string, { slug?: string } | undefined>
    const slug = existing?.slug || sourceSlug
    // The page editor requires a slug per locale; keep any slug already set there.
    const translations = {
      en: { title: frTitle, slug: prev.en?.slug || slug, content: frDoc },
      fr: { title: frTitle, slug: prev.fr?.slug || slug, content: frDoc },
      nl: { title: nlTitle, slug: prev.nl?.slug || slug, content: nlDoc }
    }

    if (existing) {
      await (db as any).update(pagesPages).set({
        title: frTitle, content: frDoc, translations, showInNavigation, ogImage, config,
        status: published ? 'published' : 'draft', updatedAt: now
      }).where(eq(pagesPages.id, existing.id))
      log.push(`UPDATED: ${slug}`)
    } else {
      await (db as any).insert(pagesPages).values({
        id: nanoid(), teamId: org.id, owner: adminId, parentId: null, path: `/${slug}`, depth: 0, order: idx,
        title: frTitle, slug, pageType: 'pages:regular', content: frDoc, config, ogImage,
        status: published ? 'published' : 'draft', visibility: 'public', publishedAt: now,
        showInNavigation, translations, createdAt: now, updatedAt: now, createdBy: adminId, updatedBy: adminId
      })
      log.push(`CREATED: ${slug}`)
    }
  }

  // ── Locations: refresh texts, address and pin from the site (the booking setup stays) ──
  const locDir = join(source!, 'content/locations')
  if (existsSync(locDir) && (!body?.only?.length || body.only.includes('locations'))) {
    const locations = await (db as any).select({ id: bookingsLocations.id, title: bookingsLocations.title, translations: bookingsLocations.translations })
      .from(bookingsLocations).where(eq(bookingsLocations.teamId, org.id))
    for (const file of readdirSync(locDir).filter(f => f.endsWith('.fr.md'))) {
      const name = file.slice(0, -'.fr.md'.length)
      const fr = splitFrontmatter(readFileSync(join(locDir, file), 'utf-8'))
      const nlPath = join(locDir, `${name}.nl.md`)
      const nl = existsSync(nlPath) ? splitFrontmatter(fixDutch(readFileSync(nlPath, 'utf-8'))) : fr
      const loc = locations.find((l: any) => l.title === fr.data.title)
      if (!loc) { log.push(`WARNING: no location titled "${fr.data.title}"`); continue }
      const frHtml = nodesToHtml(await markdownToNodes(fr.body, upload))
      const nlHtml = nl.body ? nodesToHtml(await markdownToNodes(nl.body, upload)) : frHtml
      const prev = (loc.translations || {}) as Record<string, Record<string, unknown>>
      const block = (d: Record<string, any>, html: string, base: Record<string, unknown> = {}) => ({
        ...base, title: d.title || fr.data.title, street: d.street || fr.data.street || '', zip: String(d.zip || fr.data.zip || ''), city: d.city || fr.data.city || '', content: html
      })
      const coords = (() => { try { const g = JSON.parse(fr.data.location); return Array.isArray(g?.coordinates) ? JSON.stringify(g.coordinates.map(Number)) : null } catch { return null } })()
      await (db as any).update(bookingsLocations).set({
        street: fr.data.street || '', zip: String(fr.data.zip || ''), city: fr.data.city || '', content: frHtml,
        ...(coords ? { location: coords } : {}),
        translations: { ...prev, fr: block(fr.data, frHtml, prev.fr), en: block(fr.data, frHtml, prev.en), nl: block(nl.data, nlHtml, prev.nl) },
        updatedAt: now
      }).where(eq(bookingsLocations.id, loc.id))
      log.push(`UPDATED location: ${fr.data.title}`)
    }
  }

  return { success: true, summary: log }
})
