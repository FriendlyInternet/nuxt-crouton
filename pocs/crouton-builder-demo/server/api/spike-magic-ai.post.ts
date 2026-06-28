/**
 * ✨ Magic v2 (#909, epic #905) — the AI tier of the magic button. Given the blocks
 * dropped on the app-canvas (+ an optional typed intent), Claude PROPOSES + RANKS a few
 * layout archetypes. It does NOT emit a raw LayoutTree (structured outputs can't express
 * the recursive tree, and we don't want it inventing unviable trees): it returns a flat,
 * constrained shape — a ranked list of { pattern, blockOrder, title, rationale } — and the
 * CLIENT materializes each into a real tree via the deterministic composer, which re-checks
 * viability (#710). The deterministic composer is the viability guardrail; the AI only
 * proposes + ranks + explains.
 *
 * The AI tier is an **optional add-on** (the `@fyit/crouton-ai` package, detected via
 * `useCroutonApps().hasApp('ai')` on the client — same stub pattern crouton-pages uses).
 * This route reuses crouton-ai's `createAIProvider()` (auto-imported) for key resolution +
 * provider caching, so there's no fresh SDK path. Latest Claude model per the `claude-api`
 * skill: `claude-opus-4-8`.
 *
 * Graceful + cheap: no API key → `{ source: 'unavailable' }` (the client degrades to the
 * deterministic v1); any error → `{ source: 'error' }` (same). POC-local; pocs are
 * test-exempt — genuine logic graduates to `packages/*` test-first later (#774).
 */
import { generateObject } from 'ai'
import { z } from 'zod'

const LAYOUT_PATTERNS = ['master-detail', 'form-centric', 'calendar-primary', 'dashboard', 'stacked'] as const

const ProposalSchema = z.object({
  pattern: z.enum(LAYOUT_PATTERNS).describe('Which archetype arrangement to use.'),
  blockOrder: z.array(z.string()).describe('The given blockIds in the order/priority you want them placed.'),
  title: z.string().describe('A short human label for this layout (3–4 words).'),
  rationale: z.string().describe('One sentence: why this arrangement suits these blocks and the intent.'),
})
const OutputSchema = z.object({
  proposals: z.array(ProposalSchema).min(1).max(3).describe('2–3 layouts, ranked best-first.'),
})

function buildPrompt(blocks: Array<{ blockId: string, label?: string }>, intent: string): string {
  const list = blocks.map(b => `- ${b.blockId}${b.label ? ` ("${b.label}")` : ''}`).join('\n')
  return [
    'You are arranging a small admin app from a set of UI blocks dropped on a canvas.',
    '',
    'Available blocks (use these exact blockIds in blockOrder):',
    list,
    '',
    intent ? `The builder's intent: "${intent}"` : 'No specific intent was given — infer a sensible default.',
    '',
    'Propose 2–3 distinct layout archetypes, ranked best-first, choosing a `pattern` for each:',
    '- master-detail: a list beside a form (browse + edit).',
    '- form-centric: the form dominant, the rest as a side rail.',
    '- calendar-primary: a calendar dominant with a list rail (only if a calendar-like block exists).',
    '- dashboard: stats/KPIs across the top, list + form below.',
    '- stacked: everything in one column (a safe fallback).',
    '',
    'Pick patterns that actually fit the blocks present. Each proposal must include every',
    'blockId in blockOrder. Keep titles short and rationales to one sentence.',
  ].join('\n')
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ blocks?: Array<{ blockId: string, label?: string }>, intent?: string }>(event)
  const blocks = Array.isArray(body?.blocks) ? body!.blocks.filter(b => b?.blockId) : []
  const intent = typeof body?.intent === 'string' ? body.intent.slice(0, 280) : ''
  if (!blocks.length) return { source: 'empty' as const, proposals: [] }

  const config = useRuntimeConfig(event)
  const apiKey = (config.anthropicApiKey as string)
    || process.env.NUXT_ANTHROPIC_API_KEY
    || process.env.NITRO_ANTHROPIC_API_KEY
    || ''
  // No key → tell the client to degrade to the deterministic v1 (no error surfaced).
  if (!apiKey) return { source: 'unavailable' as const, proposals: [] }

  try {
    // crouton-ai's provider factory (auto-imported) — resolves the key + caches the provider.
    const model = createAIProvider(event).model('claude-opus-4-8')
    const result = await generateObject({
      model,
      schema: OutputSchema,
      prompt: buildPrompt(blocks, intent),
    })
    const object = result.object as z.infer<typeof OutputSchema>
    return { source: 'ai' as const, proposals: object.proposals }
  }
  catch (err) {
    // Any failure (rate limit, network, refusal) → client degrades to deterministic v1.
    return { source: 'error' as const, proposals: [], message: err instanceof Error ? err.message : String(err) }
  }
})
