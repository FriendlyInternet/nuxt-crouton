// Public blog index — published posts, newest first. No auth, no team scope.
// The admin CRUD is team-scoped (server/api/teams/[id]/blog-posts), but the
// public reader is a single shared blog: it reads every published post.
import { eq, desc } from 'drizzle-orm'
import { blogPosts } from '~~/server/db/schema'

export default defineEventHandler(async () => {
  const db = useDB() as any

  const rows = await db
    .select({
      id: blogPosts.id,
      title: blogPosts.title,
      slug: blogPosts.slug,
      author: blogPosts.author,
      publishedAt: blogPosts.publishedAt,
      tags: blogPosts.tags,
      body: blogPosts.body,
    })
    .from(blogPosts)
    .where(eq(blogPosts.status, 'published'))
    .orderBy(desc(blogPosts.publishedAt))

  // Strip the rich-text HTML to a short plain-text excerpt and drop the full body.
  return rows.map((r: any) => {
    const text = String(r.body ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return {
      id: r.id,
      title: r.title,
      slug: r.slug,
      author: r.author,
      publishedAt: r.publishedAt,
      tags: Array.isArray(r.tags) ? r.tags : [],
      excerpt: text.length > 200 ? `${text.slice(0, 200).trimEnd()}…` : text,
    }
  })
})
