import { generateText } from 'ai'

/**
 * Draft an SEO meta description from a page's title + content.
 *
 * POST /api/ai/generate-seo
 *   { title: string, content?: string, language?: string } → { description: string }
 *
 * Mirrors generate-page's provider/auth wiring (createAIProvider + requireAuth).
 * Content may be TipTap JSON, HTML, or plain text — we flatten it to text so the
 * model has the page's substance to summarise.
 */

// Pull readable text out of TipTap JSON / HTML / plain text, capped for the prompt.
function flattenContent(raw: unknown): string {
  if (!raw) return ''
  let value = raw
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{')) {
      try { value = JSON.parse(trimmed) }
      catch { return trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000) }
    } else {
      return trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000)
    }
  }
  const parts: string[] = []
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.text === 'string') parts.push(node.text)
    for (const k of ['content', 'title', 'description', 'headline']) {
      if (typeof node.attrs?.[k] === 'string') parts.push(node.attrs[k])
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(value)
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 3000)
}

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const { title, content, language } = await readBody<{
    title?: string
    content?: unknown
    language?: string
  }>(event)

  const text = flattenContent(content)
  if (!title?.trim() && !text) {
    throw createError({ status: 400, statusText: 'A title or content is required' })
  }

  const ai = createAIProvider(event)
  const modelId = ai.getDefaultModel()

  const langInstruction = language
    ? ` Write the description in ${language}.`
    : ''

  const system = `You write concise, compelling SEO meta descriptions for web pages.`
    + ` Return ONLY the description text — no quotes, no label, no markdown.`
    + ` It must be a single sentence or two, 140–160 characters, summarising the page's value clearly and invitingly.${langInstruction}`

  const user = `Page title: ${title?.trim() || '(untitled)'}\n\nPage content:\n${text || '(no body content yet — base it on the title)'}`

  const { text: description } = await generateText({
    model: ai.model(modelId),
    system,
    messages: [{ role: 'user', content: user }],
  })

  return { description: description.trim().replace(/^["']|["']$/g, '') }
})
