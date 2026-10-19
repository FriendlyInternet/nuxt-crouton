/**
 * Image migration: Bunny CDN + local files → R2
 *
 * Collects all alexdeforce.b-cdn.net URLs from article frontmatter and bodies,
 * downloads each image, uploads to R2 via blob storage, and updates article
 * imageUrl fields with new paths.
 *
 * Also migrates ~15 local files from alexdeforce_v2/public/img/.
 *
 * Trigger via POST /api/seed/images
 *
 * Prerequisites:
 * - Content must be seeded first (POST /api/seed/content)
 * - Dev server must be running (for blob storage access)
 *
 * Skips: Mixcloud/Bandcamp thumbnails (external platform images)
 */
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { contentArticles } from '~~/layers/content/collections/articles/server/database/schema'
import { contentAgendas } from '~~/layers/content/collections/agendas/server/database/schema'
import { croutonAssets } from '@fyit/crouton-assets/collections/assets/server/database/schema'
import { organization, member } from '~~/server/db/schema'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const LOCAL_IMG_DIR = '/Users/pmcp/Projects/alexdeforce_v2/public/img'
const CDN_PATTERN = /https?:\/\/alexdeforce\.b-cdn\.net\/[^\s"')]+/g

/** Skip external platform thumbnails — not our images */
const SKIP_DOMAINS = [
  'thumbnailer.mixcloud.com',
  'f4.bcbits.com',
  'i1.sndcdn.com',
  'i.ytimg.com'
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shouldSkipUrl(url: string): boolean {
  return SKIP_DOMAINS.some(domain => url.includes(domain))
}

function getContentType(url: string): string {
  const ext = extname(new URL(url).pathname).toLowerCase()
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif'
  }
  return types[ext] || 'image/jpeg'
}

function getContentTypeFromFile(filename: string): string {
  const ext = extname(filename).toLowerCase()
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif'
  }
  return types[ext] || 'image/jpeg'
}

/** Download an image from URL, returns buffer + content type */
async function downloadImage(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') || getContentType(url)
    return { buffer, contentType }
  } catch {
    return null
  }
}

/** Extract a clean pathname for R2 from a CDN URL */
function cdnUrlToPathname(url: string): string {
  const parsed = new URL(url)
  // e.g. /3b1688d4-3091-428f-9949-ebc8c9001020.jpg → alexdeforce/3b1688d4...jpg
  const filename = parsed.pathname.split('/').pop() || 'image.jpg'
  return `alexdeforce/${filename}`
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default defineEventHandler(async () => {
  if (!import.meta.dev) {
    throw createError({ status: 403, statusText: 'Seed endpoint is only available in development' })
  }

  const db = useDB()
  const log: string[] = []

  try {
    // Find the organization and user for asset ownership
    const orgs = await (db as any).select().from(organization).limit(1)
    if (orgs.length === 0) {
      throw createError({ status: 404, statusText: 'No organization found.' })
    }
    const orgId = orgs[0].id
    const members = await (db as any).select().from(member).where(eq(member.organizationId, orgId)).limit(1)
    const ownerId = members?.[0]?.userId || orgId

    // Clear existing asset records before re-seeding
    await (db as any).delete(croutonAssets).where(eq(croutonAssets.teamId, orgId))
    log.push('Cleared existing asset records')

    // Get all articles
    const articles = await (db as any).select().from(contentArticles)
    const agendas = await (db as any).select().from(contentAgendas)

    // -------------------------------------------------------------------
    // 1. Collect all unique CDN URLs from articles
    // -------------------------------------------------------------------
    const urlToNewPath = new Map<string, string>()
    const articleUrlMap = new Map<string, Set<string>>() // articleId -> set of CDN URLs

    for (const article of articles) {
      const urls = new Set<string>()

      // Check imageUrl
      if (article.imageUrl && article.imageUrl.includes('alexdeforce.b-cdn.net')) {
        urls.add(article.imageUrl)
      }

      // Check content body for CDN URLs
      if (article.content) {
        const matches = article.content.match(CDN_PATTERN) || []
        for (const url of matches) {
          urls.add(url)
        }
      }

      if (urls.size > 0) {
        articleUrlMap.set(article.id, urls)
        for (const url of urls) {
          if (!shouldSkipUrl(url)) {
            urlToNewPath.set(url, cdnUrlToPathname(url))
          }
        }
      }
    }

    // Also check agenda thumbnails
    const agendaUrlMap = new Map<string, string>()
    for (const agenda of agendas) {
      if (agenda.thumbnail && agenda.thumbnail.includes('alexdeforce.b-cdn.net') && !shouldSkipUrl(agenda.thumbnail)) {
        const newPath = cdnUrlToPathname(agenda.thumbnail)
        urlToNewPath.set(agenda.thumbnail, newPath)
        agendaUrlMap.set(agenda.id, agenda.thumbnail)
      }
    }

    log.push(`Found ${urlToNewPath.size} unique CDN URLs to migrate`)

    // -------------------------------------------------------------------
    // 2. Download and upload each image to R2
    // -------------------------------------------------------------------
    let uploaded = 0
    let failed = 0
    const uploadedPaths = new Map<string, string>() // old URL -> new /images/... path

    for (const [url, pathname] of urlToNewPath) {
      const result = await downloadImage(url)
      if (!result) {
        log.push(`FAILED to download: ${url}`)
        failed++
        continue
      }

      try {
        await blob.put(pathname, result.buffer, {
          contentType: result.contentType
        })
        uploadedPaths.set(url, `/images/${pathname}`)

        // Create asset record in DB
        const filename = pathname.split('/').pop() || 'image.jpg'
        await (db as any).insert(croutonAssets).values({
          id: nanoid(),
          teamId: orgId,
          owner: ownerId,
          userId: ownerId,
          filename,
          pathname,
          contentType: result.contentType,
          size: result.buffer.length,
          category: 'image',
          uploadedAt: new Date(),
          createdBy: ownerId,
          updatedBy: ownerId
        })

        uploaded++
      } catch (err: any) {
        log.push(`FAILED to upload ${pathname}: ${err.message}`)
        failed++
      }
    }

    log.push(`Uploaded ${uploaded} images (${failed} failed)`)

    // -------------------------------------------------------------------
    // 3. Update article imageUrl and content with new R2 paths
    // -------------------------------------------------------------------
    let articlesUpdated = 0

    for (const [articleId, urls] of articleUrlMap) {
      const article = articles.find((a: any) => a.id === articleId)
      if (!article) continue

      let newImageUrl = article.imageUrl
      let newContent = article.content

      for (const url of urls) {
        const newPath = uploadedPaths.get(url)
        if (!newPath) continue

        // Update imageUrl if it matches
        if (newImageUrl === url) {
          newImageUrl = newPath
        }

        // Replace in content body
        if (newContent) {
          newContent = newContent.replaceAll(url, newPath)
        }
      }

      // Only update if something changed
      if (newImageUrl !== article.imageUrl || newContent !== article.content) {
        await (db as any).update(contentArticles)
          .set({
            imageUrl: newImageUrl,
            content: newContent,
            updatedAt: new Date()
          })
          .where(eq(contentArticles.id, articleId))
        articlesUpdated++
      }
    }

    // Update agenda thumbnails
    let agendasUpdated = 0
    for (const [agendaId, oldUrl] of agendaUrlMap) {
      const newPath = uploadedPaths.get(oldUrl)
      if (!newPath) continue

      await (db as any).update(contentAgendas)
        .set({
          thumbnail: newPath,
          updatedAt: new Date()
        })
        .where(eq(contentAgendas.id, agendaId))
      agendasUpdated++
    }

    log.push(`Updated ${articlesUpdated} articles and ${agendasUpdated} agenda items with new R2 paths`)

    // -------------------------------------------------------------------
    // 4. Migrate local files from public/img/
    // -------------------------------------------------------------------
    let localUploaded = 0
    if (existsSync(LOCAL_IMG_DIR)) {
      const localFiles = readdirSync(LOCAL_IMG_DIR).filter(f =>
        /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(f)
      )

      for (const file of localFiles) {
        const filePath = resolve(LOCAL_IMG_DIR, file)
        const buffer = readFileSync(filePath)
        const pathname = `alexdeforce/local/${file}`

        try {
          const contentType = getContentTypeFromFile(file)
          await blob.put(pathname, buffer, { contentType })

          // Create asset record in DB
          await (db as any).insert(croutonAssets).values({
            id: nanoid(),
            teamId: orgId,
            owner: ownerId,
            userId: ownerId,
            filename: file,
            pathname,
            contentType,
            size: buffer.length,
            category: 'image',
            uploadedAt: new Date(),
            createdBy: ownerId,
            updatedBy: ownerId
          })

          localUploaded++
        } catch (err: any) {
          log.push(`FAILED local file ${file}: ${err.message}`)
        }
      }

      log.push(`Uploaded ${localUploaded} local files from public/img/`)

      // Update article references for local files
      // Local files in content appear as relative paths like "img/filename.jpg"
      // or "/img/filename.jpg" — replace with "/images/alexdeforce/local/filename"
      let localArticlesUpdated = 0
      const freshArticles = await (db as any).select().from(contentArticles).where(eq(contentArticles.teamId, orgId))

      for (const article of freshArticles) {
        let newImageUrl = article.imageUrl
        let newContent = article.content
        let changed = false

        for (const file of localFiles) {
          const blobPath = `/images/alexdeforce/local/${file}`
          // Match local path patterns (most specific first, stop after first match per file)
          const patterns = [
            `./img/${file}`,
            `/img/${file}`,
            `img/${file}`,
          ]

          for (const pattern of patterns) {
            if (newImageUrl && newImageUrl.includes(pattern) && !newImageUrl.startsWith('/images/')) {
              newImageUrl = blobPath
              changed = true
            }
            if (newContent && newContent.includes(pattern)) {
              newContent = newContent.replaceAll(pattern, blobPath)
              changed = true
              break // Don't try less-specific patterns that would double-replace
            }
          }
        }

        if (changed) {
          await (db as any).update(contentArticles)
            .set({
              imageUrl: newImageUrl,
              content: newContent,
              updatedAt: new Date()
            })
            .where(eq(contentArticles.id, article.id))
          localArticlesUpdated++
        }
      }

      log.push(`Updated ${localArticlesUpdated} articles with local file paths`)
    } else {
      log.push('No local img directory found, skipping')
    }

    const totalAssets = uploaded + localUploaded
    log.push(`Created ${totalAssets} asset records in media library`)

    // -------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------
    return {
      success: true,
      summary: log,
      counts: {
        cdnUrls: urlToNewPath.size,
        uploaded,
        failed,
        articlesUpdated,
        agendasUpdated,
        localFiles: localUploaded
      }
    }
  } catch (error: any) {
    if (error.statusCode || error.status) throw error
    console.error('Image migration error:', error)
    throw createError({
      status: 500,
      statusText: `Image migration failed: ${error.message}\n${error.stack || ''}`
    })
  }
})
