// Public single-post reader — published posts only. 404 for unknown or draft.
import { eq, and, desc } from 'drizzle-orm'
import { blogPosts } from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({ status: 400, statusText: 'Missing slug' })
  }

  const db = useDB() as any

  // slug is unique per team, not globally; for the single public blog we take
  // the most recently published match.
  const [post] = await db
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
    .where(and(eq(blogPosts.slug, slug), eq(blogPosts.status, 'published')))
    .orderBy(desc(blogPosts.publishedAt))
    .limit(1)

  if (!post) {
    throw createError({ status: 404, statusText: 'Post not found' })
  }

  return {
    ...post,
    tags: Array.isArray(post.tags) ? post.tags : [],
  }
})
