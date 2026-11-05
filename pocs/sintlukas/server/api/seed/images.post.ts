/**
 * Image migration: local files → R2 blob storage
 *
 * Reads image metadata files from the old sintLukas2024 project to build
 * an asset-ID → file-path mapping, then uploads actual image files to R2
 * and updates all DB records with new /images/sintlukas/... paths.
 *
 * Handles:
 * - Atelier mainImage / cardImage (asset IDs → resolved paths)
 * - Atelier images gallery (array of asset IDs)
 * - Person images (direct file paths)
 * - News images (direct file paths)
 * - Category thumbnails and backgrounds (direct file paths)
 *
 * Trigger via POST /api/seed/images
 *
 * Prerequisites:
 * - Content must be seeded first (POST /api/seed/content)
 * - Dev server must be running (for blob storage access)
 */
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, extname, basename } from 'node:path'
import { contentAteliers } from '~~/layers/content/collections/ateliers/server/database/schema'
import { contentPersons } from '~~/layers/content/collections/persons/server/database/schema'
import { contentNews } from '~~/layers/content/collections/news/server/database/schema'
import { contentCategories } from '~~/layers/content/collections/categories/server/database/schema'
import { croutonAssets } from '@fyit/crouton-assets/collections/assets/server/database/schema'
import { organization, member } from '~~/server/db/schema'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SOURCE_ROOT = '/Users/pmcp/Projects/sintLukas2024'
const IMAGES_META_DIR = resolve(SOURCE_ROOT, 'content/media/images')
const UPLOADS_DIR = resolve(SOURCE_ROOT, 'public/assets/uploads')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getContentType(filename: string): string {
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

/** Parse simple YAML frontmatter from image metadata files */
function parseFrontmatter(md: string): Record<string, string> {
  const match = md.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1]!.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (kv) result[kv[1]!] = kv[2]!.trim()
  }
  return result
}

/** Build mapping of asset ID → local file path */
function buildAssetIdMap(): Map<string, string> {
  const map = new Map<string, string>()

  if (!existsSync(IMAGES_META_DIR)) return map

  const files = readdirSync(IMAGES_META_DIR).filter(f => f.endsWith('.md'))
  for (const file of files) {
    const raw = readFileSync(resolve(IMAGES_META_DIR, file), 'utf-8')
    const data = parseFrontmatter(raw)
    if (data.id && data.cover) {
      // cover is like /assets/uploads/banner-atelier-jongeren.jpg
      const localPath = resolve(SOURCE_ROOT, 'public', data.cover.replace(/^\//, ''))
      map.set(data.id, localPath)
    }
  }

  return map
}

/** Upload a local file to R2 and return the blob pathname */
async function uploadFile(
  localPath: string,
  blobPrefix: string
): Promise<{ pathname: string; contentType: string; size: number } | null> {
  if (!existsSync(localPath)) return null

  const filename = basename(localPath)
  const pathname = `${blobPrefix}/${filename}`
  const contentType = getContentType(filename)
  const buffer = readFileSync(localPath)

  try {
    await blob.put(pathname, buffer, { contentType })
    return { pathname, contentType, size: buffer.length }
  } catch {
    return null
  }
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
  const uploadedPaths = new Map<string, string>() // localPath → /images/pathname

  try {
    // Find org and user
    const orgs = await (db as any).select().from(organization).limit(1)
    if (orgs.length === 0) {
      throw createError({ status: 404, statusText: 'No organization found.' })
    }
    const orgId = orgs[0].id
    const members = await (db as any).select().from(member).where(eq(member.organizationId, orgId)).limit(1)
    const ownerId = members?.[0]?.userId || orgId

    // Clear existing asset records
    await (db as any).delete(croutonAssets).where(eq(croutonAssets.teamId, orgId))
    log.push('Cleared existing asset records')

    // Build asset ID → local file path mapping
    const assetIdMap = buildAssetIdMap()
    log.push(`Built asset ID map: ${assetIdMap.size} entries`)

    // Helper: upload and track
    let uploaded = 0
    let failed = 0

    async function uploadAndTrack(localPath: string): Promise<string | null> {
      // Deduplicate: if already uploaded, return cached path
      if (uploadedPaths.has(localPath)) return uploadedPaths.get(localPath)!

      const result = await uploadFile(localPath, 'sintlukas')
      if (!result) {
        log.push(`FAILED: ${localPath}`)
        failed++
        return null
      }

      const imagePath = `/images/${result.pathname}`
      uploadedPaths.set(localPath, imagePath)

      // Create asset record
      await (db as any).insert(croutonAssets).values({
        id: nanoid(),
        teamId: orgId,
        owner: ownerId,
        userId: ownerId,
        filename: basename(localPath),
        pathname: result.pathname,
        contentType: result.contentType,
        size: result.size,
        category: 'image',
        uploadedAt: new Date(),
        createdBy: ownerId,
        updatedBy: ownerId
      })

      uploaded++
      return imagePath
    }

    /** Resolve an image reference — could be an asset ID or a direct path */
    async function resolveImageRef(ref: string): Promise<string | null> {
      if (!ref) return null

      // Check if it's an asset ID (no slashes, no file extension)
      const localPathFromId = assetIdMap.get(ref)
      if (localPathFromId) {
        return uploadAndTrack(localPathFromId)
      }

      // It's a direct file path like /assets/uploads/lucia.png
      const localPath = resolve(SOURCE_ROOT, 'public', ref.replace(/^\//, ''))
      if (existsSync(localPath)) {
        return uploadAndTrack(localPath)
      }

      log.push(`NOT FOUND: ${ref}`)
      return null
    }

    // -------------------------------------------------------------------
    // 1. Migrate Atelier images
    // -------------------------------------------------------------------
    const ateliers = await (db as any).select().from(contentAteliers)
    let ateliersUpdated = 0

    for (const atelier of ateliers) {
      let changed = false
      let newMainImage = atelier.mainImage
      let newCardImage = atelier.cardImage
      let newImages = atelier.images

      // mainImage (asset ID)
      if (atelier.mainImage) {
        const resolved = await resolveImageRef(atelier.mainImage)
        if (resolved) {
          newMainImage = resolved
          changed = true
        }
      }

      // cardImage (asset ID)
      if (atelier.cardImage) {
        const resolved = await resolveImageRef(atelier.cardImage)
        if (resolved) {
          newCardImage = resolved
          changed = true
        }
      }

      // images gallery (array of asset IDs)
      if (Array.isArray(atelier.images) && atelier.images.length > 0) {
        const resolvedImages: string[] = []
        for (const imgRef of atelier.images) {
          const resolved = await resolveImageRef(imgRef)
          if (resolved) resolvedImages.push(resolved)
        }
        if (resolvedImages.length > 0) {
          newImages = resolvedImages
          changed = true
        }
      }

      if (changed) {
        await (db as any).update(contentAteliers)
          .set({
            mainImage: newMainImage,
            cardImage: newCardImage,
            images: newImages,
            updatedAt: new Date()
          })
          .where(eq(contentAteliers.id, atelier.id))
        ateliersUpdated++
      }
    }
    log.push(`Updated ${ateliersUpdated} ateliers`)

    // -------------------------------------------------------------------
    // 2. Migrate Person images
    // -------------------------------------------------------------------
    const persons = await (db as any).select().from(contentPersons)
    let personsUpdated = 0

    for (const person of persons) {
      if (person.image && !person.image.startsWith('/images/')) {
        const resolved = await resolveImageRef(person.image)
        if (resolved) {
          await (db as any).update(contentPersons)
            .set({ image: resolved, updatedAt: new Date() })
            .where(eq(contentPersons.id, person.id))
          personsUpdated++
        }
      }
    }
    log.push(`Updated ${personsUpdated} persons`)

    // -------------------------------------------------------------------
    // 3. Migrate News images
    // -------------------------------------------------------------------
    const news = await (db as any).select().from(contentNews)
    let newsUpdated = 0

    for (const item of news) {
      if (item.image && !item.image.startsWith('/images/')) {
        const resolved = await resolveImageRef(item.image)
        if (resolved) {
          await (db as any).update(contentNews)
            .set({ image: resolved, updatedAt: new Date() })
            .where(eq(contentNews.id, item.id))
          newsUpdated++
        }
      }
    }
    log.push(`Updated ${newsUpdated} news items`)

    // -------------------------------------------------------------------
    // 4. Migrate Category thumbnails and backgrounds
    // -------------------------------------------------------------------
    const categories = await (db as any).select().from(contentCategories)
    let categoriesUpdated = 0

    for (const cat of categories) {
      let changed = false
      let newThumb = cat.thumbnail
      let newBg = cat.background

      if (cat.thumbnail && !cat.thumbnail.startsWith('/images/')) {
        const resolved = await resolveImageRef(cat.thumbnail)
        if (resolved) { newThumb = resolved; changed = true }
      }
      if (cat.background && !cat.background.startsWith('/images/')) {
        const resolved = await resolveImageRef(cat.background)
        if (resolved) { newBg = resolved; changed = true }
      }

      if (changed) {
        await (db as any).update(contentCategories)
          .set({ thumbnail: newThumb, background: newBg, updatedAt: new Date() })
          .where(eq(contentCategories.id, cat.id))
        categoriesUpdated++
      }
    }
    log.push(`Updated ${categoriesUpdated} categories`)

    // -------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------
    log.push(`Total: ${uploaded} images uploaded, ${failed} failed`)

    return {
      success: true,
      summary: log,
      counts: {
        assetIdsMapped: assetIdMap.size,
        uploaded,
        failed,
        ateliersUpdated,
        personsUpdated,
        newsUpdated,
        categoriesUpdated
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
