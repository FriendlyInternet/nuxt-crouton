import { generateText } from 'ai'
import { fetchReferencePage } from '../../utils/fetch-reference-page'

function buildSystemPrompt(language?: string): string {
  const languageInstruction = language
    ? `\n## Language\nAll copy — headings, descriptions, button labels, SEO fields — MUST be written in ${language}. Do not use any other language.\n`
    : ''

  return `You are a web page content generator for a modern website CMS.
Generate a complete, compelling page structure based on the user's brief.
${languageInstruction}
## Available Block Types

### heroBlock
Full-width hero section — always use this as the first block.
Attrs: { headline?: string, title: string, description?: string, orientation: 'vertical'|'horizontal', reverse: boolean, links: Link[], image?: string }

### sectionBlock
Feature grid section with icon-based feature cards.
Attrs: { title?: string, description?: string, orientation: 'vertical'|'horizontal', reverse: boolean, features: Feature[], links: Link[] }
Feature: { icon?: string, title: string, description?: string }

### ctaBlock
Call-to-action banner — use for conversion sections.
Attrs: { title: string, description?: string, variant: 'subtle'|'soft'|'outline'|'naked', orientation: 'horizontal'|'vertical', links: Link[] }

### cardGridBlock
Grid of cards — use for showcasing multiple items.
Attrs: { title?: string, description?: string, columns: 2|3|4, cards: Card[] }
Card: { title: string, description?: string, icon?: string, to?: string }

### separatorBlock
Visual divider between sections.
Attrs: { label?: string, icon?: string, type: 'solid'|'dashed'|'dotted' }

### richTextBlock
Rich text paragraph content.
Attrs: { content: string } — content is an HTML string

## Link format
{ label: string, to: string, color?: 'primary'|'secondary'|'neutral'|'error'|'warning'|'success', variant?: 'solid'|'soft'|'outline'|'ghost' }

## Icon format
Use Lucide icons: i-lucide-star, i-lucide-zap, i-lucide-shield, i-lucide-code, i-lucide-rocket, i-lucide-heart, i-lucide-check, i-lucide-users, i-lucide-globe, i-lucide-lock, i-lucide-chart-bar, i-lucide-layout, i-lucide-mail, i-lucide-phone, i-lucide-clock, i-lucide-trending-up, etc.

## Output Format

Return ONLY a valid JSON object — no markdown fences, no explanation, nothing else:
{
  "seoTitle": "Concise page title for search engines (50–60 chars)",
  "seoDescription": "Compelling meta description (140–160 chars)",
  "blocks": {
    "type": "doc",
    "content": [
      { "type": "heroBlock", "attrs": { ... } },
      { "type": "sectionBlock", "attrs": { ... } }
    ]
  }
}

## Rules
- Always start blocks with a heroBlock
- Include 3–5 blocks total, in a logical page flow
- Copy should be specific, compelling, and relevant to the brief
- Use placeholder links: to="#" or to="/contact"
- Orientation: prefer "vertical" for hero, "horizontal" for feature sections
- reverse: alternate true/false across sections for visual variety
- ctaBlock: typically the last or second-to-last block before footer
- seoTitle: should match the hero title but optimised for search (no brand suffix needed)
- seoDescription: should summarise the page value proposition clearly`
}

// Extract meaningful text from HTML without external dependencies
function extractPageContent(html: string): string {
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  const lines: string[] = []

  const titleMatch = clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) lines.push(`Title: ${titleMatch[1]!.trim()}`)

  const metaMatch = clean.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || clean.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
  if (metaMatch) lines.push(`Meta description: ${metaMatch[1]!.trim()}`)

  const headingMatches = clean.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)
  for (const match of headingMatches) {
    const text = match[2]!.replace(/<[^>]+>/g, '').trim()
    if (text) lines.push(`H${match[1]}: ${text}`)
  }

  const paraMatches = [...clean.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].slice(0, 10)
  for (const match of paraMatches) {
    const text = match[1]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (text.length > 20) lines.push(text)
  }

  return lines.join('\n').slice(0, 3000)
}

async function fetchPageContent(url: string): Promise<string | null> {
  const html = await fetchReferencePage(url)
  return html === null ? null : extractPageContent(html)
}

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const { brief, url, language } = await readBody<{
    brief: string
    url?: string
    language?: string
  }>(event)

  if (!brief?.trim()) {
    throw createError({ status: 400, statusText: 'Brief is required' })
  }

  let referenceContent: string | null = null
  if (url?.trim()) {
    referenceContent = await fetchPageContent(url.trim())
  }

  const ai = createAIProvider(event)
  const modelId = ai.getDefaultModel()

  const userMessage = referenceContent
    ? `Create a page for: ${brief.trim()}\n\n---\nFor inspiration, here is the content extracted from ${url}:\n\n${referenceContent}\n\nUse the structure, tone, and messaging as inspiration — but write fresh copy adapted to the brief.`
    : `Create a page for: ${brief.trim()}`

  const { text } = await generateText({
    model: ai.model(modelId),
    system: buildSystemPrompt(language),
    messages: [{ role: 'user', content: userMessage }]
  })

  const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  try {
    const parsed = JSON.parse(cleaned)

    // Support both new format { seoTitle, seoDescription, blocks } and legacy { type:'doc', content }
    if (parsed.blocks?.type === 'doc' && Array.isArray(parsed.blocks.content)) {
      return {
        content: JSON.stringify(parsed.blocks),
        seoTitle: parsed.seoTitle || '',
        seoDescription: parsed.seoDescription || ''
      }
    }

    // Legacy fallback (blocks at root level)
    if (parsed.type === 'doc' && Array.isArray(parsed.content)) {
      return { content: JSON.stringify(parsed), seoTitle: '', seoDescription: '' }
    }

    throw new Error('Invalid page structure returned')
  }
  catch {
    throw createError({
      status: 500,
      statusText: 'Failed to generate valid page structure. Try a more specific brief.'
    })
  }
})
